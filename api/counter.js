export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    console.warn("Vercel KV environment variables are not set. Using fallback mock counter.");
    const baseVisits = 0;
    return res.status(200).json({ visits: baseVisits, mock: true });
  }

  try {
    const isGetOnly = req.query.action === 'get';
    const endpoint = isGetOnly ? 'get/visits' : 'incr/visits';
    
    const kvResponse = await fetch(`${url}/${endpoint}`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!kvResponse.ok) {
      throw new Error(`KV REST API error: ${kvResponse.status} ${kvResponse.statusText}`);
    }

    const data = await kvResponse.json();
    const result = data.result;

    let visits = result !== null ? Number(result) : 0;
    
    if (isNaN(visits)) {
      visits = 0;
    }

    return res.status(200).json({ visits });
  } catch (error) {
    console.error("Error updating/fetching visit counter:", error);
    return res.status(500).json({ error: "Failed to update visit counter", fallbackVisits: 0 });
  }
}
