// Same-origin Swagger UI: server.mjs proxies /v1 to Go, so the HttpOnly session
// cookie set by POST /sessions is reused by "Try it out" (Go checks Origin).
window.ui = SwaggerUIBundle({
  url: 'openapi.yaml',
  dom_id: '#swagger',
  deepLinking: true,
  displayOperationId: true,
  displayRequestDuration: true,
  docExpansion: 'list',
  defaultModelsExpandDepth: 1,
  withCredentials: true,
  supportedSubmitMethods: ['get', 'post', 'put'],
});
