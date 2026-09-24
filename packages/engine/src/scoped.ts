import {
  can, require as requirePermission, scopeOf, scopeAllows, Forbidden,
  type Action, type Principal, type Resource, type ResourceKind,
} from '@edsai/auth';
import type { RunStore } from './store.js';
import type { Client, Contact, Project } from './entities.js';
import type { Onboarding, Answer } from './onboarding.js';
import type { BrandValue } from './brand.js';
import type { Comparator } from './positioning.js';
import type { Asset } from './assets.js';
import type { Run } from './types.js';
import type { Deliverable } from './deliverables.js';
import type { ClientDocument } from './documents.js';
import { hubEnabled, type BrandHub, type BrandProject } from './brand-hub.js';
import type { Milestone } from './milestones.js';
import type { Invoice } from './invoices.js';
import type { Message } from './messages.js';
import type { Feedback } from './feedback.js';
import type { SupportNote } from './support.js';
import type { DepartmentOverride } from './process.js';

/**
 * The data boundary.
 *
 * `@edsai/auth` decides *whether* a principal may do something; this is *where*
 * that decision is applied. The split matters: a policy that route handlers are
 * trusted to call is a policy that stops being applied the first time someone
 * adds a route and forgets, and the brief is explicit that hiding something in
 * the interface is not authorization.
 *
 * Anything serving a request goes through here. `RunStore` itself stays
 * unscoped because the CLI is the machine's owner operating on their own
 * database file — a check there would protect nothing they could not bypass by
 * opening the file. The API never holds a `RunStore`; it holds one of these.
 *
 * Reads **filter**, writes **throw**. A read that threw would tell a caller
 * that something exists at an id they are not allowed to know about, which is
 * the same disclosure the policy refuses to make in its refusal messages.
 */
export class ScopedStore {
  constructor(
    private readonly store: RunStore,
    readonly principal: Principal,
  ) {}

  private resource(kind: ResourceKind, clientId: string, collection?: string): Resource {
    return { kind, clientId, ...(collection ? { collection } : {}) };
  }

  private mayRead(kind: ResourceKind, clientId: string): boolean {
    return can(this.principal, 'read', this.resource(kind, clientId)).allowed;
  }

  private mustWrite(kind: ResourceKind, clientId: string, action: Action = 'write'): void {
    requirePermission(this.principal, action, this.resource(kind, clientId));
  }

  /** Which clients this principal can see at all — used to scope list queries. */
  private visibleClientIds(): readonly string[] | 'all' {
    const scope = scopeOf(this.principal);
    return scope === 'all' ? 'all' : scope.clientIds;
  }

  /* ----------------------------------------------------------------- clients */

  listClients(): Client[] {
    const scope = this.visibleClientIds();
    return this.store.listClients().filter((client) =>
      (scope === 'all' || scope.includes(client.id)) && this.mayRead('client', client.id));
  }

  getClient(id: string): Client | undefined {
    const client = this.store.getClient(id);
    if (!client || !this.mayRead('client', client.id)) return undefined;
    return client;
  }

  getClientBySlug(slug: string): Client | undefined {
    const client = this.store.getClientBySlug(slug);
    if (!client || !this.mayRead('client', client.id)) return undefined;
    return client;
  }

  saveClient(client: Client): void {
    this.mustWrite('client', client.id);
    this.store.saveClient(client);
  }

  /**
   * Only when the record is empty. A client with a project, a run, a file, an
   * invoice — anything hanging off it — is not something a single click
   * should be able to erase; `status: 'archived'` (set through `saveClient`)
   * is the reversible way to put one out of the way. This is for the record
   * created by mistake five minutes ago, nothing else.
   */
  deleteClient(id: string): void {
    this.mustWrite('client', id);
    this.store.deleteClient(id);
  }

  /* ---------------------------------------------------------------- contacts */

  listContacts(clientId: string): Contact[] {
    if (!this.mayRead('contact', clientId)) return [];
    return this.store.listContacts(clientId);
  }

  getContact(id: string): Contact | undefined {
    const contact = this.store.getContact(id);
    if (!contact || !this.mayRead('contact', contact.clientId)) return undefined;
    return contact;
  }

  saveContact(contact: Contact): void {
    this.mustWrite('contact', contact.clientId);
    this.store.saveContact(contact);
  }

  deleteContact(id: string): void {
    const existing = this.store.getContact(id);
    if (!existing) return;
    this.mustWrite('contact', existing.clientId);
    this.store.deleteContact(id);
  }

  /* ---------------------------------------------------------------- projects */

  listProjects(clientId?: string): Project[] {
    const scope = this.visibleClientIds();
    // A portal asking for "all projects" gets its own, not an error: the scope
    // is a property of the session, so there is nothing to refuse.
    const projects = clientId === undefined
      ? (scope === 'all'
        ? this.store.listProjects()
        : scope.flatMap((id) => this.store.listProjects(id)))
      : this.store.listProjects(clientId);
    return projects.filter((project) => this.mayRead('project', project.clientId));
  }

  getProject(id: string): Project | undefined {
    const project = this.store.getProject(id);
    if (!project || !this.mayRead('project', project.clientId)) return undefined;
    return project;
  }

  saveProject(project: Project): void {
    this.mustWrite('project', project.clientId);
    this.store.saveProject(project);
  }

  /** Only when no run has ever been started against it — a run is the
   * project's own history, and this is not where that gets erased. */
  deleteProject(id: string): void {
    const existing = this.store.getProject(id);
    if (!existing) return;
    this.mustWrite('project', existing.clientId);
    this.store.deleteProject(id);
  }

  /* -------------------------------------------------------------------- runs */

  listRuns(): Run[] {
    const scope = this.visibleClientIds();
    const runs = scope === 'all'
      ? this.store.listRuns()
      : scope.flatMap((id) => this.store.listRuns(id));
    return runs.filter((run) => this.mayRead('run', run.clientId));
  }

  getRun(id: string): Run | undefined {
    const run = this.store.getRun(id);
    if (!run || !this.mayRead('run', run.clientId)) return undefined;
    return run;
  }

  deleteRun(id: string): void {
    const run = this.store.getRun(id);
    if (!run) return;
    this.mustWrite('run', run.clientId);
    this.store.deleteRun(id);
  }

  /* ----------------------------------------------------------------- assets */

  /**
   * Assets this principal may see.
   *
   * A studio sees everything the client has. A portal sees only what has been
   * approved — an unapproved asset is the studio's working copy, and a client
   * finding it in their own portal is the kind of leak that is embarrassing
   * rather than dangerous, which makes it easy to forget.
   */
  listAssets(clientId: string): Asset[] {
    // The coarse gate is the client scope, not `read` on a collection-less
    // resource: a `limited` session is defined by which collections it may see,
    // so asking whether it can read "assets in general" is a question with no
    // true answer, and the first version of this returned nothing at all.
    if (!this.inScope(clientId)) return [];

    return this.store.listAssets(clientId).filter((asset) => {
      if (this.principal.kind !== 'studio' && !asset.approved) return false;
      return can(this.principal, 'read',
        this.resource('asset', clientId, asset.collection ?? 'default')).allowed;
    });
  }

  /**
   * Every asset this principal may see, across every client they may see.
   *
   * Built from the two scoped reads rather than a query of its own, so the
   * client filter and the approval filter cannot drift apart from the
   * per-client view. A portal session sees exactly one client's approved files,
   * which is the same answer `listAssets` gives — this is a convenience, not a
   * wider door.
   */
  listAllAssets(): Asset[] {
    return this.listClients().flatMap((client) => this.listAssets(client.id));
  }

  getAsset(id: string): Asset | undefined {
    const asset = this.store.getAsset(id);
    if (!asset) return undefined;
    // Resolved through the same list, so the approval and collection rules
    // cannot be bypassed by knowing an id.
    return this.listAssets(asset.clientId).find((candidate) => candidate.id === id);
  }

  saveAsset(asset: Asset): void {
    this.mustWrite('asset', asset.clientId);
    this.store.saveAsset(asset);
  }

  deleteAsset(id: string): void {
    const existing = this.store.getAsset(id);
    if (!existing) return;
    this.mustWrite('asset', existing.clientId);
    this.store.deleteAsset(id);
  }

  /* ------------------------------------------------------------ comparators */

  /**
   * The brands placed beside this client's on a positioning chart.
   *
   * Read through `brand`, because that is what a comparator is about — it exists
   * only to sit next to this client's own position, and a session that may not
   * see the brand has no business seeing what it was compared against.
   */
  listComparators(clientId: string): Comparator[] {
    if (!this.mayRead('brand', clientId)) return [];
    return this.store.listComparators(clientId);
  }

  saveComparator(comparator: Comparator): void {
    this.mustWrite('brand', comparator.clientId);
    this.store.saveComparator(comparator);
  }

  deleteComparator(id: string): void {
    const existing = this.store.getComparator(id);
    if (!existing) return;
    this.mustWrite('brand', existing.clientId);
    this.store.deleteComparator(id);
  }

  /* ----------------------------------------------------------- brand values */

  listBrandValues(clientId: string): BrandValue[] {
    if (!this.mayRead('brand', clientId)) return [];
    return this.store.listBrandValues(clientId);
  }

  saveBrandValue(value: BrandValue): void {
    this.mustWrite('brand', value.clientId);
    this.store.saveBrandValue(value);
  }

  deleteBrandValue(clientId: string, name: string): void {
    this.mustWrite('brand', clientId);
    this.store.deleteBrandValue(clientId, name);
  }

  /* ------------------------------------------------------------ deliverables */

  listDeliverables(clientId: string): Deliverable[] {
    if (!this.mayRead('deliverable', clientId)) return [];
    return this.store.listDeliverables(clientId);
  }

  saveDeliverable(deliverable: Deliverable): void {
    this.mustWrite('deliverable', deliverable.clientId);
    this.store.saveDeliverable(deliverable);
  }

  deleteDeliverable(id: string): void {
    const existing = this.store.getDeliverable(id);
    if (!existing) return;
    this.mustWrite('deliverable', existing.clientId);
    this.store.deleteDeliverable(id);
  }

  /* --------------------------------------------------------------- brand hub */

  /**
   * A portal reads its hub only while it is active — a draft or suspended
   * hub is the studio's business and reads as "no hub" from outside, which
   * is also what a client who never bought one sees.
   */
  getBrandHub(clientId: string): BrandHub | undefined {
    if (!this.mayRead('brand-hub', clientId)) return undefined;
    const hub = this.store.getBrandHub(clientId);
    if (this.principal.kind === 'portal' && !hubEnabled(hub)) return undefined;
    return hub;
  }

  saveBrandHub(hub: BrandHub): void {
    this.mustWrite('brand-hub', hub.clientId);
    this.store.saveBrandHub(hub);
  }

  /** Projects exist only inside an enabled hub, on both sides. */
  listBrandProjects(clientId: string): BrandProject[] {
    if (!this.mayRead('brand-project', clientId)) return [];
    if (!this.getBrandHub(clientId)) return [];
    return this.store.listBrandProjects(clientId);
  }

  getBrandProject(id: string): BrandProject | undefined {
    const project = this.store.getBrandProject(id);
    if (!project || !this.mayRead('brand-project', project.clientId)) return undefined;
    if (!this.getBrandHub(project.clientId)) return undefined;
    return project;
  }

  saveBrandProject(project: BrandProject): void {
    this.mustWrite('brand-project', project.clientId);
    if (!this.getBrandHub(project.clientId)) {
      throw new Forbidden('write', { kind: 'brand-project', clientId: project.clientId },
        'this client has no active Brand Hub, so nothing can be made in one');
    }
    this.store.saveBrandProject(project);
  }

  deleteBrandProject(id: string): void {
    const existing = this.store.getBrandProject(id);
    if (!existing) return;
    this.mustWrite('brand-project', existing.clientId);
    this.store.deleteBrandProject(id);
  }

  /* --------------------------------------------------------------- documents */

  listDocuments(clientId: string): ClientDocument[] {
    if (!this.mayRead('document', clientId)) return [];
    return this.store.listDocuments(clientId);
  }

  saveDocument(document: ClientDocument): void {
    this.mustWrite('document', document.clientId);
    this.store.saveDocument(document);
  }

  deleteDocument(clientId: string, slot: string): void {
    this.mustWrite('document', clientId);
    this.store.deleteDocument(clientId, slot);
  }

  /* -------------------------------------------------------------- milestones */

  listMilestones(clientId: string): Milestone[] {
    if (!this.mayRead('milestone', clientId)) return [];
    return this.store.listMilestones(clientId);
  }

  saveMilestone(milestone: Milestone): void {
    this.mustWrite('milestone', milestone.clientId);
    this.store.saveMilestone(milestone);
  }

  deleteMilestone(id: string): void {
    const existing = this.store.getMilestone(id);
    if (!existing) return;
    this.mustWrite('milestone', existing.clientId);
    this.store.deleteMilestone(id);
  }

  /* ---------------------------------------------------------------- invoices */

  listInvoices(clientId: string): Invoice[] {
    if (!this.mayRead('invoice', clientId)) return [];
    return this.store.listInvoices(clientId);
  }

  saveInvoice(invoice: Invoice): void {
    this.mustWrite('invoice', invoice.clientId);
    this.store.saveInvoice(invoice);
  }

  deleteInvoice(id: string): void {
    const existing = this.store.getInvoice(id);
    if (!existing) return;
    this.mustWrite('invoice', existing.clientId);
    this.store.deleteInvoice(id);
  }

  /* ---------------------------------------------------------------- messages */

  listMessages(clientId: string): Message[] {
    if (!this.mayRead('message', clientId)) return [];
    return this.store.listMessages(clientId);
  }

  saveMessage(message: Message): void {
    this.mustWrite('message', message.clientId);
    this.store.saveMessage(message);
  }

  /* ---------------------------------------------------------------- feedback */

  listFeedback(clientId: string): Feedback[] {
    if (!this.mayRead('feedback', clientId)) return [];
    return this.store.listFeedback(clientId);
  }

  saveFeedback(feedback: Feedback): void {
    this.mustWrite('feedback', feedback.clientId);
    this.store.saveFeedback(feedback);
  }

  /**
   * Replying to feedback is a write to the same record `saveFeedback` writes,
   * which is exactly the trap: a portal principal has `write` on its own
   * client's feedback (so it can submit feedback at all), and that same
   * permission would let it forge a `response` field onto its own row through
   * the generic path. The role check in the policy has no way to see that
   * distinction — only *who* is asking does, so it is checked here, the same
   * way `canManageAccess` is kept out of the general policy table.
   */
  respondToFeedback(feedback: Feedback): void {
    if (this.principal.kind !== 'studio') {
      throw new Forbidden(
        'write', this.resource('feedback', feedback.clientId),
        'a reply to feedback comes from the studio, not from a client portal',
      );
    }
    this.mustWrite('feedback', feedback.clientId);
    this.store.saveFeedback(feedback);
  }

  /* ----------------------------------------------------------- support notes */

  /**
   * Notes about the tool itself — bugs, ideas, questions — never a client's.
   * Gated the same way every other write is, through the same `can()` the
   * client-scoped resources use, just with no client to name: see the
   * comment on `Resource.clientId` in `@edsai/auth` for why an empty string
   * there is enough on its own to keep a portal session out.
   */
  listSupportNotes(): SupportNote[] {
    if (!this.mayRead('support', '')) return [];
    return this.store.listSupportNotes();
  }

  getSupportNote(id: string): SupportNote | undefined {
    if (!this.mayRead('support', '')) return undefined;
    return this.store.getSupportNote(id);
  }

  saveSupportNote(note: SupportNote): void {
    this.mustWrite('support', '');
    this.store.saveSupportNote(note);
  }

  deleteSupportNote(id: string): void {
    this.mustWrite('support', '');
    this.store.deleteSupportNote(id);
  }

  /* --------------------------------------------------------- process overrides */

  /** Which departments this studio has excluded or reduced — see `Resource.clientId` above. */
  listProcessOverrides(): DepartmentOverride[] {
    if (!this.mayRead('process', '')) return [];
    return this.store.listProcessOverrides();
  }

  saveProcessOverride(override: DepartmentOverride): void {
    this.mustWrite('process', '');
    this.store.saveProcessOverride(override);
  }

  deleteProcessOverride(departmentId: number): void {
    this.mustWrite('process', '');
    this.store.deleteProcessOverride(departmentId);
  }

  /* ------------------------------------------------------------- onboarding */

  listOnboardings(clientId?: string): Onboarding[] {
    if (clientId !== undefined) {
      if (!this.mayRead('client', clientId)) return [];
      return this.store.listOnboardings(clientId);
    }
    // A studio-wide read, same shape as `listProjects()` with no client named:
    // everything the session's scope actually covers, nothing beyond it.
    const scope = this.visibleClientIds();
    const onboardings = scope === 'all'
      ? this.store.listOnboardings()
      : scope.flatMap((id) => this.store.listOnboardings(id));
    return onboardings.filter((onboarding) => this.mayRead('client', onboarding.clientId));
  }

  getOnboarding(id: string): Onboarding | undefined {
    const onboarding = this.store.getOnboarding(id);
    if (!onboarding || !this.mayRead('client', onboarding.clientId)) return undefined;
    return onboarding;
  }

  saveOnboarding(onboarding: Onboarding): void {
    this.mustWrite('client', onboarding.clientId, 'write');
    this.store.saveOnboarding(onboarding);
  }

  /**
   * Answering the discovery questions from inside the studio itself — the
   * same record a client's own invite link writes to, gated the same way
   * (`onboarding`'s own `client` resource) rather than through a second rule
   * for who may hold a pen.
   */
  getAnswers(onboardingId: string): Answer[] {
    const onboarding = this.store.getOnboarding(onboardingId);
    if (!onboarding || !this.mayRead('client', onboarding.clientId)) return [];
    return this.store.getAnswers(onboardingId);
  }

  saveAnswer(answer: Answer): void {
    const onboarding = this.store.getOnboarding(answer.onboardingId);
    if (!onboarding) throw new Error(`No such onboarding: ${answer.onboardingId}`);
    this.mustWrite('client', onboarding.clientId, 'write');
    this.store.saveAnswer(answer);
  }

  /**
   * The unscoped store, for a caller that has already checked.
   *
   * Named so it reads as a decision at the call site rather than as a getter.
   * Every use is a place where the scope was established some other way — a run
   * fetched through `getRun` above, for instance, is already proven visible, so
   * reading its outputs needs no second check.
   */
  unscopedAfterCheck(): RunStore {
    return this.store;
  }

  /** Whether this principal could write to a client, without doing it. */
  canWrite(kind: ResourceKind, clientId: string): boolean {
    return can(this.principal, 'write', this.resource(kind, clientId)).allowed;
  }

  /**
   * Whether this session may hand someone else a way in.
   *
   * Its own action rather than a `write`, because issuing a portal link is not
   * editing the client: an editor who could mint links could grant a stranger
   * everything an owner can see. The policy puts it at `owner`, and a portal
   * session never has it whatever its role within the client.
   */
  canManageAccess(clientId: string): boolean {
    return can(this.principal, 'manage-access', this.resource('portal', clientId)).allowed;
  }

  /** Whether a client id is inside this session's scope at all. */
  inScope(clientId: string): boolean {
    return scopeAllows(scopeOf(this.principal), clientId);
  }
}
