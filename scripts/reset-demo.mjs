const baseUrl = process.env.BOLI_LOCAL_URL ?? 'http://localhost:3000';
const response = await fetch(`${baseUrl}/api/demo/reset`, { method: 'POST' });
if (!response.ok) throw new Error(`Demo reset failed with HTTP ${response.status}.`);
console.log('Boli demo data reset.');
