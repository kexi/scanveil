---
type: Reference
title: Scanveil shared Cloud Armor edge plan
description: Operational phases and Terraform switches for introducing one shared Cloud Armor policy across Scanveil public endpoints.
resource: ../../infra/terraform/main.tf
tags: [scanveil, cloud-armor, load-balancer, security, terraform]
timestamp: 2026-06-28T00:00:00+09:00
---

# Scanveil Shared Cloud Armor Edge Plan

Scanveil should use one shared Google Cloud Armor security policy for public endpoints that move behind the shared external HTTPS Load Balancer edge. Sharing the policy keeps the Cloud Armor policy and rule count low while allowing endpoint-specific routing in the load balancer URL map.

## Operational Phases

1. Current edge, no Cloud Armor:
   - `enable_shared_edge = false`
   - `enable_cloud_armor = false`
   - Firebase Hosting and Cloud Run domain mapping remain authoritative.

2. Shared Load Balancer edge, no Cloud Armor:
   - `enable_shared_edge = true`
   - `enable_cloud_armor = false`
   - Use this phase to validate DNS, managed certificates, URL map routing, serverless NEGs, backend buckets, and OAuth or GitHub webhook callback behavior before adding WAF behavior.

3. Shared Load Balancer edge with Cloud Armor preview:
   - `enable_shared_edge = true`
   - `enable_cloud_armor = true`
   - `cloud_armor_preview = true`
   - Use this phase to observe WAF matches without blocking real users or GitHub webhook delivery.

4. Shared Load Balancer edge with Cloud Armor enforcement:
   - `enable_shared_edge = true`
   - `enable_cloud_armor = true`
   - `cloud_armor_preview = false`
   - Use this phase after reviewing preview logs and tuning false positives.

## Current Terraform Scope

The initial Terraform change defaults all new edge controls to off. When enabled, Terraform creates the shared Cloud Armor security policy with SQL injection and XSS preconfigured WAF rules plus a default allow rule. Load Balancer backends should attach this policy through their backend service or backend bucket once the shared edge resources are added.

## Endpoint Migration Notes

- `console.scanveil.kexi.dev` can move to a Cloud Run serverless NEG behind the shared external HTTPS Load Balancer.
- The GitHub webhook should move behind the same load balancer, either by enabling the Cloud Run API service or by migrating the Firebase Functions path to a compatible load-balanced backend.
- `www.scanveil.kexi.dev` and `admin.scanveil.kexi.dev` remain outside Cloud Armor while served directly by Firebase Hosting. Moving them under the shared policy requires serving them through load-balanced backends, such as Cloud Storage backend buckets or Cloud Run static serving.
- Cloud Run default URLs and direct domain mappings must be restricted or removed before relying on Cloud Armor as the only public ingress control.
