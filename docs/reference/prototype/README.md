# Prototype Reference

`docs/reference/prototype/caredesk_prototype.html` is the Claude-generated
interactive prototype the product was first sketched in. It is kept for
historical continuity only.

It used to be tracked at the repository root and, separately, shipped from
`apps/web/public/` on the production origin, where it loaded three scripts from
cdnjs without subresource integrity. It was moved here on 05.09.2026 (audit
finding SEC-WEB-04) and is no longer deployed anywhere. Do not copy it back into
`apps/web/public/`: `apps/web/src/vercel-routing-contract.test.ts` allows only
`robots.txt` and `sitemap.xml` there.

Status: **visual and interaction reference only**

Permitted use:

- screen inventory;
- information hierarchy;
- interaction ideas;
- copy candidates;
- visual comparison during redesign.

Prohibited use:

- production architecture;
- copying JavaScript state or business logic;
- copying calculations or regulatory assumptions;
- copying hard-coded text instead of translations;
- treating prototype validation, authorization, or privacy behavior as secure;
- using real personal data.

The production implementation must follow the Product Specification, AI Coding
Constitution, Design System, Database Blueprint, and accepted ADRs.
