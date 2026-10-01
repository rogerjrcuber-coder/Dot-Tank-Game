interface AssetEnvironment {
  ASSETS?: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(request: Request, environment: AssetEnvironment): Promise<Response> {
    if (environment.ASSETS) return environment.ASSETS.fetch(request);
    return new Response('Dot Tank Arena assets are unavailable.', { status: 503 });
  }
};
