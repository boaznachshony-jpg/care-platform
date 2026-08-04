import type { ActorResolver, AuthSession, ResolvedActor } from '@caredesk/application';

/** Development/test resolver for synthetic identities only. */
export class InMemoryActorResolver implements ActorResolver {
  private readonly actorByAuthSubject = new Map<string, ResolvedActor>();

  seedActor(authSubject: string, actor: ResolvedActor): void {
    this.actorByAuthSubject.set(authSubject, actor);
  }

  async resolveActor(session: AuthSession): Promise<ResolvedActor | null> {
    return this.actorByAuthSubject.get(session.authSubject) ?? null;
  }
}
