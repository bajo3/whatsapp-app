export function setCors(req: any, res: any) {
  const origin = process.env.CORS_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

export function handlePreflight(req: any, res: any) {
  if (req.method === "OPTIONS") {
    setCors(req, res);
    return res.status(204).end();
  }
  return null;
}
