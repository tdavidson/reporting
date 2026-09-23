/**
 * `@/lib/supabase/client` for the widget bundle. The components that reach for the browser
 * client use it for three things — who am I, MFA enrolment, and file uploads — none of which the
 * demo has. Each answers as a signed-out, storage-less client would, so the components render
 * their "not available" states rather than throwing.
 */
const NOT_AVAILABLE = { message: 'Not available in the demo.', name: 'DemoError', status: 403 }

function chain(): any {
  const p: any = Promise.resolve({ data: null, error: NOT_AVAILABLE })
  const handler: ProxyHandler<any> = {
    get(target, prop) {
      if (prop === 'then' || prop === 'catch' || prop === 'finally') return target[prop].bind(target)
      return () => new Proxy(Promise.resolve({ data: null, error: NOT_AVAILABLE }), handler)
    },
  }
  return new Proxy(p, handler)
}

export function createClient() {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: 'demo-viewer', email: 'viewer@otheradmin.demo' } }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
      signOut: async () => ({ error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      mfa: {
        listFactors: async () => ({ data: { all: [], totp: [], phone: [] }, error: null }),
        getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal1', nextLevel: 'aal1', currentAuthenticationMethods: [] }, error: null }),
        enroll: async () => ({ data: null, error: NOT_AVAILABLE }),
        challenge: async () => ({ data: null, error: NOT_AVAILABLE }),
        verify: async () => ({ data: null, error: NOT_AVAILABLE }),
        unenroll: async () => ({ data: null, error: NOT_AVAILABLE }),
      },
    },
    storage: {
      from: () => ({
        upload: async () => ({ data: null, error: NOT_AVAILABLE }),
        createSignedUrl: async () => ({ data: null, error: NOT_AVAILABLE }),
        download: async () => ({ data: null, error: NOT_AVAILABLE }),
        remove: async () => ({ data: null, error: NOT_AVAILABLE }),
      }),
    },
    from: () => chain(),
    rpc: () => chain(),
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}), unsubscribe: async () => {} }),
    removeChannel: () => {},
  } as any
}
