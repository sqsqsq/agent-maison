# S0 replay context

Files missing from the preserved S0 snapshot, copied read-only from Git baseline `28394b60d2d017c70c18aa01449469e0d04bf107`.
The original S0 project and outcomes are unchanged. Apply this context before the local replay baseline; it contains no later S1 implementation.
`sources.json` records each original Git blob and SHA-256. Text files use repository LF;
the 15 normalized JSON5 files separately retain their original `source_sha256` and
the explicit `CRLF->LF only` conversion. Binary assets retain their exact original bytes.
