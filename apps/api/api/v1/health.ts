import { setCors, handlePreflight } from "../_lib/cors";

export default async function handler(req: any, res: any) {
  setCors(req, res);
  if (handlePreflight(req, res)) return;

  return res.status(200).json({ ok: true });
}
