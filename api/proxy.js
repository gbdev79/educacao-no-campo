export default async function handler(req, res) {
  // Extract URL directly from req.url to preserve any query parameters appended to it
  const urlParamIndex = req.url.indexOf('?url=');
  if (urlParamIndex === -1) {
    return res.status(400).json({ error: "Missing url parameter" });
  }
  
  const targetUrl = req.url.substring(urlParamIndex + 5);
  let url = decodeURIComponent(targetUrl);

  // Security: only allow expected external domains
  if (!url.startsWith('https://servicodados.ibge.gov.br/') && 
      !url.startsWith('https://apisidra.ibge.gov.br/')) {
    return res.status(403).json({ error: "Forbidden domain" });
  }

  try {
    const response = await fetch(url);
    
    if (!response.ok) {
        throw new Error(`Failed to fetch from ${url}: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Edge Caching: Cache on Vercel CDN for 1 day (86400 seconds)
    // stale-while-revalidate allows serving stale content while fetching fresh data in the background
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
    
    // Also allow CORS just in case it's called directly from a dev environment
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    res.status(200).json(data);
  } catch (error) {
    console.error("Proxy error:", error);
    res.status(500).json({ error: "Error fetching external data" });
  }
}
