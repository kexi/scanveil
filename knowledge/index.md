---
type: Knowledge Bundle
title: Scanveil project knowledge
description: Repository-local knowledge bundle for Scanveil implementation and operations context.
resource: https://github.com/kexi/gcp-hackathon-poc
tags: [scanveil, okf, project-knowledge]
timestamp: 2026-06-20T14:46:50Z
---

# Scanveil project knowledge

This directory stores repository-local knowledge as Markdown files with YAML frontmatter, following the Open Knowledge Format idea of keeping context as readable files in version control.

## Concepts

- [Scanveil system overview](system-overview.md)
- [Scanveil infrastructure architecture](architecture/scanveil-infrastructure.md)
- [Scanveil AI scan agent](reference/scan-ai-agent.md)
- [Scanveil SVE deduplication](reference/sve-deduplication.md)
- [Hackathon technology requirements fit](reference/hackathon-requirements.md)
- [Antigravity runner evaluation](work/2026-06-21-antigravity-runner-evaluation.md)
- [Scanveil GitHub App settings](reference/github-app-settings.md)
- [Scanveil naming and domains](reference/scanveil-naming.md)
- [Scanveil shared Cloud Armor edge plan](reference/cloud-armor-edge-plan.md)
- [2026-06-20 Admin scan, branding, social preview, and deploy](work/2026-06-20-admin-scan-branding-deploy.md)
- [Change log](log.md)

## Presentation assets

- [System architecture diagram (detailed)](architecture/scanveil-system-architecture.drawio)
- [System architecture diagram (for judges)](architecture/scanveil-architecture-judges.drawio)
- [Demo video slide deck](slides/scanveil-demo-slides.html)

## Format

Each concept file uses frontmatter fields that are easy for humans and agents to query:

- `type`
- `title`
- `description`
- `resource`
- `tags`
- `timestamp`

## References

- [Introducing the Open Knowledge Format](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing?hl=en)
