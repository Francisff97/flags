export async function GET() {
  return new Response("hello from flags 🔥", {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}