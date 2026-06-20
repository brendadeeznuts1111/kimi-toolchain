declare module "bun:bundle" {
  interface Registry {
    DEBUG: boolean;
    ONLINE: boolean;
    MOCK_API: boolean;
    PREMIUM: boolean;
  }
}
