variable "project_id" {
  description = "Google Cloud project ID."
  type        = string
}

variable "region" {
  description = "Google Cloud region."
  type        = string
  default     = "us-central1"
}

variable "api_image" {
  description = "Container image for the webhook API Cloud Run service."
  type        = string
  default     = null
}

variable "worker_image" {
  description = "Container image for the scan worker Cloud Run job."
  type        = string
  default     = null
}

variable "agy_runner_image" {
  description = "Container image for the experimental Antigravity scan runner Cloud Run job."
  type        = string
  default     = null
}

variable "web_image" {
  description = "Container image for the management console Cloud Run service."
  type        = string
}

variable "github_app_id" {
  description = "GitHub App ID."
  type        = string
  default     = null
}

variable "github_oauth_client_id" {
  description = "GitHub OAuth client ID for the Scanveil web service."
  type        = string
}

variable "schedule" {
  description = "Cloud Scheduler cron expression for scheduled scans."
  type        = string
  default     = "0 */6 * * *"
}

variable "enable_api" {
  description = "Whether to deploy the webhook API Cloud Run service. Requires enable_worker so webhooks can execute scans."
  type        = bool
  default     = false
}

variable "enable_worker" {
  description = "Whether to deploy the scan worker Cloud Run job and Vertex AI resources."
  type        = bool
  default     = false
}

variable "enable_agy_runner" {
  description = "Whether to deploy the experimental Antigravity scan runner Cloud Run job."
  type        = bool
  default     = false
}

variable "enable_firestore" {
  description = "Whether to deploy Firestore resources for persisted scan data. Worker deployments force Firestore on."
  type        = bool
  default     = true
}

variable "enable_scheduled_scan" {
  description = "Whether to deploy Cloud Scheduler for the worker job when enable_worker is true."
  type        = bool
  default     = true
}

variable "enable_shared_edge" {
  description = "Whether to route public Scanveil endpoints through the shared HTTPS Load Balancer edge. Defaults off so the current Firebase Hosting and Cloud Run domain mapping stay unchanged."
  type        = bool
  default     = false
}

variable "enable_cloud_armor" {
  description = "Whether to create and attach the shared Cloud Armor policy for the shared edge. Ignored unless enable_shared_edge is true."
  type        = bool
  default     = false
}

variable "cloud_armor_preview" {
  description = "Whether Cloud Armor deny rules run in preview mode before enforcement."
  type        = bool
  default     = true
}

variable "llm_input_usd_per_1m_tokens" {
  description = "Estimated Vertex AI input token price per 1M tokens for the default scan LLM model. Override when model pricing changes."
  type        = number
  default     = 0.25
}

variable "llm_output_usd_per_1m_tokens" {
  description = "Estimated Vertex AI output token price per 1M tokens for the default scan LLM model. Override when model pricing changes."
  type        = number
  default     = 1.50
}
