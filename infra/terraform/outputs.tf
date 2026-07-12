output "api_url" {
  value = var.enable_api ? google_cloud_run_v2_service.api[0].uri : null
}

output "web_url" {
  value = google_cloud_run_v2_service.web.uri
}

output "scanveil_console_domain" {
  value = local.scanveil_console_domain
}

output "scanveil_admin_domain" {
  value = local.scanveil_admin_domain
}

output "scanveil_dns_name_servers" {
  value = google_dns_managed_zone.scanveil.name_servers
}

output "scanveil_docs_domain" {
  value = trimsuffix(local.firebase_hosting_www_domain, ".")
}

output "shared_cloud_armor_policy" {
  value = local.is_cloud_armor_enabled ? google_compute_security_policy.shared_edge[0].name : null
}
