locals {
  service_prefix            = "scanveil"
  is_vertex_enabled         = var.enable_worker || var.enable_agy_runner
  is_firestore_enabled      = var.enable_firestore || var.enable_worker
  is_scheduled_scan_enabled = var.enable_worker && var.enable_scheduled_scan
  is_cloud_armor_enabled    = var.enable_shared_edge && var.enable_cloud_armor
  required_services = toset(concat([
    "artifactregistry.googleapis.com",
    "dns.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com"
    ],
    local.is_vertex_enabled ? ["aiplatform.googleapis.com"] : [],
    local.is_firestore_enabled ? ["firestore.googleapis.com"] : [],
    var.enable_worker ? ["storage.googleapis.com"] : [],
    var.enable_shared_edge || local.is_cloud_armor_enabled ? ["compute.googleapis.com"] : [],
    local.is_scheduled_scan_enabled ? ["cloudscheduler.googleapis.com"] : []
  ))
  scanveil_zone_dns_name        = "scanveil.kexi.dev."
  scanveil_console_domain       = "console.scanveil.kexi.dev"
  scanveil_console_base_url     = "https://console.scanveil.kexi.dev"
  scanveil_console_dns_name     = "console.scanveil.kexi.dev."
  scanveil_admin_domain         = "admin.scanveil.kexi.dev"
  scanveil_admin_dns_name       = "admin.scanveil.kexi.dev."
  scanveil_hooks_domain         = "hooks.scanveil.kexi.dev"
  scanveil_hooks_dns_name       = "hooks.scanveil.kexi.dev."
  firebase_hosting_www_domain   = "www.scanveil.kexi.dev."
  firebase_hosting_admin_host   = "scanveil-admin.web.app."
  firebase_hosting_web_app_host = "kexi-380010.web.app."
}

resource "google_project_service" "services" {
  for_each = local.required_services

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# Dedicated app-image repository. Why not reuse the GCF-managed `gcf-artifacts`
# repo: Firebase's automatic cleanup policy on that repo has deleted a pushed
# worker image, so app images need a repository Scanveil owns and controls.
resource "google_artifact_registry_repository" "apps" {
  location      = var.region
  repository_id = "${local.service_prefix}-apps"
  format        = "DOCKER"
  description   = "Scanveil application container images (worker, api, console, agy-runner)."

  depends_on = [google_project_service.services]
}

resource "google_service_account" "api_runtime" {
  count = var.enable_api ? 1 : 0

  account_id   = "${local.service_prefix}-api-runtime"
  display_name = "Scanveil webhook API runtime"
}

resource "google_service_account" "web_runtime" {
  account_id   = "${local.service_prefix}-web-runtime"
  display_name = "Scanveil Management Console runtime"
}

resource "google_service_account" "worker_runtime" {
  count = local.is_vertex_enabled ? 1 : 0

  account_id   = "${local.service_prefix}-worker-runtime"
  display_name = "Scanveil worker runtime"
}

resource "google_service_account" "functions_webhook_runtime" {
  account_id   = "${local.service_prefix}-functions-webhook"
  display_name = "Scanveil Firebase webhook function runtime"
}

resource "google_service_account" "functions_admin_runtime" {
  account_id   = "${local.service_prefix}-functions-admin"
  display_name = "Scanveil Firebase admin function runtime"
}

resource "google_service_account" "scheduler" {
  count = local.is_scheduled_scan_enabled ? 1 : 0

  account_id   = "${local.service_prefix}-scheduler"
  display_name = "Scanveil scheduler"
}

resource "google_dns_managed_zone" "scanveil" {
  name        = "scanveil-kexi-dev"
  dns_name    = local.scanveil_zone_dns_name
  description = "Managed zone for scanveil.kexi.dev."
  visibility  = "public"

  depends_on = [google_project_service.services]
}

resource "google_dns_record_set" "scanveil_apex_firebase_hosting" {
  name         = local.scanveil_zone_dns_name
  managed_zone = google_dns_managed_zone.scanveil.name
  type         = "A"
  ttl          = 300
  rrdatas      = ["199.36.158.100"]
}

resource "google_dns_record_set" "scanveil_apex_acme_challenge" {
  name         = "_acme-challenge.${local.scanveil_zone_dns_name}"
  managed_zone = google_dns_managed_zone.scanveil.name
  type         = "TXT"
  ttl          = 300
  rrdatas      = ["\"GiS8ke7rXDplAeD4oLnrlO29OUXxdpppPfHJ27nLHLs\""]
}

resource "google_dns_record_set" "firebase_hosting_www" {
  name         = local.firebase_hosting_www_domain
  managed_zone = google_dns_managed_zone.scanveil.name
  type         = "CNAME"
  ttl          = 300
  rrdatas      = [local.firebase_hosting_web_app_host]
}

resource "google_dns_record_set" "firebase_hosting_www_acme_challenge" {
  name         = "_acme-challenge.${local.firebase_hosting_www_domain}"
  managed_zone = google_dns_managed_zone.scanveil.name
  type         = "TXT"
  ttl          = 300
  rrdatas      = ["\"fKR7EAbI-DUhG-8lc71YN8h4i3rEehHMMrYj2qIoXLc\""]
}

resource "google_dns_record_set" "firebase_hosting_admin" {
  name         = local.scanveil_admin_dns_name
  managed_zone = google_dns_managed_zone.scanveil.name
  type         = "CNAME"
  ttl          = 300
  rrdatas      = [local.firebase_hosting_admin_host]
}

resource "google_dns_record_set" "firebase_hosting_admin_acme_challenge" {
  name         = "_acme-challenge.${local.scanveil_admin_dns_name}"
  managed_zone = google_dns_managed_zone.scanveil.name
  type         = "TXT"
  ttl          = 300
  rrdatas      = ["\"ZIdDX41LxMQiYNh4ZoAUcTLxQqN_Z76XNc7P-G2JO7w\""]
}

resource "google_dns_record_set" "cloud_run_console" {
  name         = local.scanveil_console_dns_name
  managed_zone = google_dns_managed_zone.scanveil.name
  type         = "CNAME"
  ttl          = 300
  rrdatas      = ["ghs.googlehosted.com."]
}

resource "google_dns_record_set" "cloud_run_hooks" {
  name         = local.scanveil_hooks_dns_name
  managed_zone = google_dns_managed_zone.scanveil.name
  type         = "CNAME"
  ttl          = 300
  rrdatas      = ["ghs.googlehosted.com."]
}

resource "google_firestore_database" "default" {
  count = local.is_firestore_enabled ? 1 : 0

  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"

  depends_on = [google_project_service.services]
}

# Why not a TTL on the chunk's own timestamp field: Firestore deletes documents
# once the TTL field's value is in the past, so keying TTL to the write time
# would purge chunks immediately. The worker writes expireAt = timestamp + 30d.
resource "google_firestore_field" "scan_stream_chunks_expire_at" {
  count = local.is_firestore_enabled ? 1 : 0

  project    = var.project_id
  database   = google_firestore_database.default[0].name
  collection = "scanStreamChunks"
  field      = "expireAt"

  ttl_config {}
}

resource "google_firestore_field" "fix_pr_stream_chunks_expire_at" {
  count = local.is_firestore_enabled ? 1 : 0

  project    = var.project_id
  database   = google_firestore_database.default[0].name
  collection = "fixPrStreamChunks"
  field      = "expireAt"

  ttl_config {}
}

resource "google_storage_bucket" "scan_artifacts" {
  count = var.enable_worker ? 1 : 0

  name                        = "${var.project_id}-${local.service_prefix}-scan-artifacts"
  location                    = var.region
  force_destroy               = false
  uniform_bucket_level_access = true

  lifecycle_rule {
    action {
      type = "Delete"
    }

    condition {
      age = 30
    }
  }

  depends_on = [google_project_service.services]
}

resource "google_compute_security_policy" "shared_edge" {
  count = local.is_cloud_armor_enabled ? 1 : 0

  name        = "${local.service_prefix}-shared-edge"
  description = "Shared Cloud Armor policy for public Scanveil edge backends."
  type        = "CLOUD_ARMOR"

  rule {
    action      = "deny(403)"
    priority    = 1000
    description = "Block common SQL injection attempts across shared public endpoints."
    preview     = var.cloud_armor_preview

    match {
      expr {
        expression = "evaluatePreconfiguredWaf('sqli-stable')"
      }
    }
  }

  rule {
    action      = "deny(403)"
    priority    = 1010
    description = "Block common cross-site scripting attempts across shared public endpoints."
    preview     = var.cloud_armor_preview

    match {
      expr {
        expression = "evaluatePreconfiguredWaf('xss-stable')"
      }
    }
  }

  rule {
    action      = "allow"
    priority    = 2147483647
    description = "Default allow so endpoint-specific authentication and webhook signature checks stay authoritative."

    match {
      versioned_expr = "SRC_IPS_V1"

      config {
        src_ip_ranges = ["*"]
      }
    }
  }

  depends_on = [google_project_service.services]
}

resource "google_secret_manager_secret" "github_private_key" {
  secret_id = "GITHUB_APP_PRIVATE_KEY"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret" "github_webhook_secret" {
  secret_id = "GITHUB_WEBHOOK_SECRET"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret" "github_oauth_client_secret" {
  secret_id = "GITHUB_OAUTH_CLIENT_SECRET"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_iam_member" "web_github_private_key_accessor" {
  secret_id = google_secret_manager_secret.github_private_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.web_runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "worker_github_private_key_accessor" {
  count = var.enable_worker ? 1 : 0

  secret_id = google_secret_manager_secret.github_private_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.worker_runtime[0].email}"
}

resource "google_secret_manager_secret_iam_member" "functions_admin_github_private_key_accessor" {
  secret_id = google_secret_manager_secret.github_private_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.functions_admin_runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "api_github_webhook_secret_accessor" {
  count = var.enable_api ? 1 : 0

  secret_id = google_secret_manager_secret.github_webhook_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api_runtime[0].email}"
}

resource "google_secret_manager_secret_iam_member" "functions_webhook_secret_accessor" {
  secret_id = google_secret_manager_secret.github_webhook_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.functions_webhook_runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "web_github_oauth_client_secret_accessor" {
  secret_id = google_secret_manager_secret.github_oauth_client_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.web_runtime.email}"
}

resource "google_cloud_run_v2_service" "api" {
  count = var.enable_api ? 1 : 0

  name                = "${local.service_prefix}-api"
  location            = var.region
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"

  lifecycle {
    precondition {
      condition     = var.api_image != null && var.github_app_id != null && var.enable_worker
      error_message = "api_image, github_app_id, and enable_worker are required when enable_api is true."
    }
  }

  template {
    service_account = google_service_account.api_runtime[0].email

    containers {
      image = var.api_image

      env {
        name  = "GITHUB_APP_ID"
        value = var.github_app_id
      }

      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }

      env {
        name  = "GOOGLE_CLOUD_REGION"
        value = var.region
      }

      env {
        name  = "SCAN_WORKER_JOB_NAME"
        value = "${local.service_prefix}-worker"
      }

      env {
        name = "GITHUB_WEBHOOK_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.github_webhook_secret.secret_id
            version = "latest"
          }
        }
      }
    }
  }

  scaling {
    min_instance_count = 0
  }
}

resource "google_cloud_run_v2_service_iam_member" "api_public" {
  count = var.enable_api ? 1 : 0

  location = google_cloud_run_v2_service.api[0].location
  name     = google_cloud_run_v2_service.api[0].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service" "web" {
  name                = "${local.service_prefix}-web"
  location            = var.region
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"

  lifecycle {
    precondition {
      condition     = var.github_app_id != null
      error_message = "github_app_id is required for the web dashboard GitHub App repository list."
    }
  }

  scaling {
    min_instance_count = 0
  }

  template {
    service_account = google_service_account.web_runtime.email

    containers {
      image = var.web_image

      env {
        name  = "GITHUB_APP_ID"
        value = var.github_app_id
      }

      env {
        name  = "GITHUB_OAUTH_CLIENT_ID"
        value = var.github_oauth_client_id
      }

      env {
        name  = "SECURITY_APP_WEB_BASE_URL"
        value = local.scanveil_console_base_url
      }

      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }

      env {
        name  = "GOOGLE_CLOUD_REGION"
        value = var.region
      }

      env {
        name  = "SCAN_WORKER_JOB_NAME"
        value = "${local.service_prefix}-worker"
      }

      dynamic "env" {
        for_each = local.is_scheduled_scan_enabled ? [1] : []
        content {
          name  = "SCAN_SCHEDULER_JOB_NAME"
          value = google_cloud_scheduler_job.scheduled_scan[0].name
        }
      }

      dynamic "env" {
        for_each = var.enable_worker ? [1] : []
        content {
          name  = "SECURITY_APP_SCAN_ARTIFACT_BUCKET"
          value = google_storage_bucket.scan_artifacts[0].name
        }
      }

      env {
        name = "GITHUB_OAUTH_CLIENT_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.github_oauth_client_secret.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "GITHUB_APP_PRIVATE_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.github_private_key.secret_id
            version = "latest"
          }
        }
      }
    }
  }
}

resource "google_cloud_run_v2_service_iam_member" "web_public" {
  location = google_cloud_run_v2_service.web.location
  name     = google_cloud_run_v2_service.web.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_domain_mapping" "console" {
  location = var.region
  name     = local.scanveil_console_domain

  metadata {
    namespace = var.project_id
  }

  spec {
    route_name = google_cloud_run_v2_service.web.name
  }
}

resource "google_cloud_run_domain_mapping" "hooks" {
  location = var.region
  name     = local.scanveil_hooks_domain

  metadata {
    namespace = var.project_id
  }

  spec {
    # Why not reference a terraform resource: the githubWebhook function is
    # deployed by the Firebase CLI, so its underlying Cloud Run service only
    # exists as this literal service name.
    route_name = "githubwebhook"
  }
}

resource "google_cloud_run_v2_job" "worker" {
  count = var.enable_worker ? 1 : 0

  name                = "${local.service_prefix}-worker"
  location            = var.region
  deletion_protection = false

  lifecycle {
    precondition {
      condition     = var.worker_image != null && var.github_app_id != null
      error_message = "worker_image and github_app_id are required when enable_worker is true."
    }
  }

  template {
    template {
      service_account = google_service_account.worker_runtime[0].email
      timeout         = "1800s"
      max_retries     = 0

      containers {
        image = var.worker_image

        env {
          name  = "GITHUB_APP_ID"
          value = var.github_app_id
        }

        env {
          name = "GITHUB_APP_PRIVATE_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.github_private_key.secret_id
              version = "latest"
            }
          }
        }

        env {
          name  = "GOOGLE_CLOUD_PROJECT"
          value = var.project_id
        }

        env {
          name  = "GOOGLE_CLOUD_REGION"
          value = var.region
        }

        env {
          name  = "GOOGLE_CLOUD_LOCATION"
          value = "global"
        }

        env {
          name  = "SECURITY_APP_LLM_INPUT_USD_PER_1M_TOKENS"
          value = tostring(var.llm_input_usd_per_1m_tokens)
        }

        env {
          name  = "SECURITY_APP_LLM_OUTPUT_USD_PER_1M_TOKENS"
          value = tostring(var.llm_output_usd_per_1m_tokens)
        }

        env {
          name  = "SECURITY_APP_SCAN_ARTIFACT_BUCKET"
          value = google_storage_bucket.scan_artifacts[0].name
        }

        env {
          name  = "PYTHONPATH"
          value = "/app/agy-vendor:/app/apps/agy-runner"
        }

        env {
          name  = "SECURITY_APP_WEB_BASE_URL"
          value = local.scanveil_console_base_url
        }

        env {
          name  = "SECURITY_APP_AGY_RUNNER_COMMAND"
          value = "python3"
        }

        env {
          name  = "SECURITY_APP_AGY_RUNNER_ARGS_JSON"
          value = jsonencode(["/app/apps/agy-runner/run.py"])
        }

        env {
          name  = "GOOGLE_GENAI_USE_VERTEXAI"
          value = "true"
        }
      }
    }
  }
}

resource "google_cloud_run_v2_job" "agy_runner" {
  count = var.enable_agy_runner ? 1 : 0

  name                = "${local.service_prefix}-agy-runner"
  location            = var.region
  deletion_protection = false

  lifecycle {
    precondition {
      condition     = var.agy_runner_image != null
      error_message = "agy_runner_image is required when enable_agy_runner is true."
    }
  }

  template {
    template {
      service_account = google_service_account.worker_runtime[0].email
      timeout         = "1800s"
      max_retries     = 0

      containers {
        image = var.agy_runner_image

        env {
          name  = "GOOGLE_CLOUD_PROJECT"
          value = var.project_id
        }

        env {
          name  = "GOOGLE_CLOUD_REGION"
          value = var.region
        }

        env {
          name  = "GOOGLE_CLOUD_LOCATION"
          value = "global"
        }

        env {
          name  = "SECURITY_APP_LLM_INPUT_USD_PER_1M_TOKENS"
          value = tostring(var.llm_input_usd_per_1m_tokens)
        }

        env {
          name  = "SECURITY_APP_LLM_OUTPUT_USD_PER_1M_TOKENS"
          value = tostring(var.llm_output_usd_per_1m_tokens)
        }

        env {
          name  = "GOOGLE_GENAI_USE_VERTEXAI"
          value = "true"
        }
      }
    }
  }
}

resource "google_cloud_scheduler_job" "scheduled_scan" {
  count = local.is_scheduled_scan_enabled ? 1 : 0

  name        = "${local.service_prefix}-scheduled-scan"
  description = "Trigger scheduled Scanveil scans."
  schedule    = var.schedule
  region      = var.region

  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.worker[0].name}:run"

    oauth_token {
      service_account_email = google_service_account.scheduler[0].email
    }
  }
}

resource "google_project_iam_custom_role" "worker_job_override_runner" {
  count = var.enable_worker ? 1 : 0

  role_id     = "scanveilWorkerJobOverrideRunner"
  title       = "Scanveil Worker Job Override Runner"
  description = "Run the Scanveil worker Cloud Run job with request-specific container overrides."
  permissions = [
    "run.executions.cancel",
    "run.executions.get",
    "run.jobs.run",
    "run.jobs.runWithOverrides",
    "run.operations.get",
  ]
}

resource "google_project_iam_custom_role" "web_scheduler_manager" {
  count = local.is_scheduled_scan_enabled ? 1 : 0

  role_id     = "scanveilWebSchedulerManager"
  title       = "Scanveil Web Scheduler Manager"
  description = "Read and update the Scanveil scheduled scan Cloud Scheduler job."
  permissions = [
    "cloudscheduler.jobs.get",
    "cloudscheduler.jobs.pause",
    # Why not cloudscheduler.jobs.resume: no such IAM permission exists;
    # resuming a paused job is granted by cloudscheduler.jobs.enable.
    "cloudscheduler.jobs.enable",
    "cloudscheduler.jobs.update",
  ]
}

resource "google_project_iam_member" "api_firestore" {
  count = var.enable_api && local.is_firestore_enabled ? 1 : 0

  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.api_runtime[0].email}"
}

resource "google_project_iam_member" "web_firestore" {
  count = local.is_firestore_enabled ? 1 : 0

  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.web_runtime.email}"
}

resource "google_project_iam_member" "web_scheduler_manager" {
  count = local.is_scheduled_scan_enabled ? 1 : 0

  project = var.project_id
  role    = google_project_iam_custom_role.web_scheduler_manager[0].name
  member  = "serviceAccount:${google_service_account.web_runtime.email}"
}

# Why not only cloudscheduler.jobs.update: updating a job whose http_target
# authenticates with the scheduler service account also requires actAs on
# that account, even when the update mask touches only schedule/timeZone.
resource "google_service_account_iam_member" "web_scheduler_act_as" {
  count = local.is_scheduled_scan_enabled ? 1 : 0

  service_account_id = google_service_account.scheduler[0].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.web_runtime.email}"
}

resource "google_project_iam_member" "worker_firestore" {
  count = var.enable_worker ? 1 : 0

  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.worker_runtime[0].email}"
}

resource "google_project_iam_member" "worker_vertex" {
  count = local.is_vertex_enabled ? 1 : 0

  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.worker_runtime[0].email}"
}

resource "google_storage_bucket_iam_member" "web_scan_artifacts_reader" {
  count = var.enable_worker ? 1 : 0

  bucket = google_storage_bucket.scan_artifacts[0].name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.web_runtime.email}"
}

resource "google_storage_bucket_iam_member" "worker_scan_artifacts_writer" {
  count = var.enable_worker ? 1 : 0

  bucket = google_storage_bucket.scan_artifacts[0].name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.worker_runtime[0].email}"
}

resource "google_cloud_run_v2_job_iam_member" "api_worker_job_override_runner" {
  count = var.enable_api && var.enable_worker ? 1 : 0

  location = google_cloud_run_v2_job.worker[0].location
  name     = google_cloud_run_v2_job.worker[0].name
  role     = google_project_iam_custom_role.worker_job_override_runner[0].name
  member   = "serviceAccount:${google_service_account.api_runtime[0].email}"
}

resource "google_cloud_run_v2_job_iam_member" "web_worker_job_override_runner" {
  count = var.enable_worker ? 1 : 0

  location = google_cloud_run_v2_job.worker[0].location
  name     = google_cloud_run_v2_job.worker[0].name
  role     = google_project_iam_custom_role.worker_job_override_runner[0].name
  member   = "serviceAccount:${google_service_account.web_runtime.email}"
}

# Why not reuse worker_job_override_runner at project level: it includes
# run.jobs.runWithOverrides, which would let the web runtime run any job in the
# project. Operations are location-scoped resources, so the job-scoped binding
# above cannot grant run.operations.get for fix PR run reconciliation.
resource "google_project_iam_custom_role" "run_operations_reader" {
  count = var.enable_worker ? 1 : 0

  role_id     = "scanveilRunOperationsReader"
  title       = "Scanveil Run Operations Reader"
  description = "Read Cloud Run operations to reconcile worker job run status."
  permissions = [
    "run.operations.get",
  ]
}

resource "google_project_iam_member" "web_run_operations_reader" {
  count = var.enable_worker ? 1 : 0

  project = var.project_id
  role    = google_project_iam_custom_role.run_operations_reader[0].name
  member  = "serviceAccount:${google_service_account.web_runtime.email}"
}

resource "google_cloud_run_v2_job_iam_member" "functions_webhook_worker_job_override_runner" {
  count = var.enable_worker ? 1 : 0

  location = google_cloud_run_v2_job.worker[0].location
  name     = google_cloud_run_v2_job.worker[0].name
  role     = google_project_iam_custom_role.worker_job_override_runner[0].name
  member   = "serviceAccount:${google_service_account.functions_webhook_runtime.email}"
}

resource "google_cloud_run_v2_job_iam_member" "scheduler_worker_job_invoker" {
  count = local.is_scheduled_scan_enabled ? 1 : 0

  location = google_cloud_run_v2_job.worker[0].location
  name     = google_cloud_run_v2_job.worker[0].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler[0].email}"
}

resource "google_project_iam_member" "functions_firestore" {
  count = local.is_firestore_enabled ? 1 : 0

  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.functions_webhook_runtime.email}"
}

resource "google_project_iam_member" "functions_admin_firestore" {
  count = local.is_firestore_enabled ? 1 : 0

  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.functions_admin_runtime.email}"
}
