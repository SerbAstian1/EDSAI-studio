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
import type { ClientDocument, ClientDocumentEntry, DocumentPage } from './documents.js';
import { figmaUrlProblem } from './figma-source.js';
import {
  assetsInBrandAsset, hubEnabled,
  type BrandAsset, type BrandHub, type BrandProject,
} from './brand-hub.js';
import type { Milestone } from './milestones.js';
import type { Event } from './events.js';
import type { Strategy } from './strategy.js';
import type { Invoice } from './invoices.js';
import type { Contract } from './contracts.js';
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

  /** Removing a project also removes its runs and their generated records. */
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

  /**
   * The file a design is about to point at, approval notwithstanding.
   *
   * `getAsset` answers "what may this session see", and a file a client has
   * just uploaded is deliberately not that. This answers the narrower question
   * "is this file this client's", which is a `clientId` comparison and nothing
   * else, so it is not a second way around the approval filter: it is the one
   * place that has to look at an unapproved file, and it can see nothing but
   * which client owns it.
   */
  ownedAsset(clientId: string, assetId: string): Asset | undefined {
    const asset = this.store.getAsset(assetId);
    if (!asset || asset.clientId !== clientId) return undefined;
    return asset;
  }

  /**
   * Approve a file that has just become a design.
   *
   * **This is the one path by which a client's own upload becomes approved**,
   * and it is narrow on purpose. Every upload lands `approved: false` so that
   * forgetting to review cannot expose a draft, and that default is not touched
   * here. What makes a design different is that it was not received — it was
   * *made*, in this client's own session, from brand files that are already
   * approved, and by a module this hub offers. There is nothing in it the studio
   * has not already signed off, and a hub built around making brand assets
   * cannot work if a client makes a pattern and is then unable to use it.
   *
   * **Writes through the store rather than `saveAsset`, deliberately.** The gate
   * that matters here is the one the design save already passed — `brand-project`
   * for this client — and `mustWrite('asset')` is a different question asked at
   * the wrong moment. Nothing weaker is available on the way in: the policy makes
   * the only principal that cannot write assets a `limited` session, and a
   * `limited` session cannot write anything at all, so it never reaches here.
   */
  approveGeneratedFile(clientId: string, assetId: string): void {
    const asset = this.ownedAsset(clientId, assetId);
    if (!asset) {
      throw new Forbidden('write', { kind: 'brand-project', clientId },
        'that file is not this client\'s');
    }
    // Approving an already-approved file would rewrite its `uploadedAt`-adjacent
    // state for nothing, and a design may legitimately be filed twice.
    if (asset.approved) return;
    this.store.saveAsset({ ...asset, approved: true });
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

  /* ------------------------------------------------------- generated assets */

  /**
   * A design exported out of a tool into the shared library.
   *
   * **`brand-project`, not `asset`, and the reason is who may do it.** A
   * `brand-project` is deliberately not studio-managed: a client writes their
   * own designs. Exporting one is a continuation of that act, not a separate
   * privilege, so borrowing `brand-project` means the permissions cannot
   * disagree — there is no way to be allowed to save a design and refused the
   * right to keep the thing they just made.
   *
   * The approval rule rides along for free. A portal session's `getAsset` will
   * not return an unapproved file, so a client cannot publish their working
   * copy into their own library and then cite it as a delivered design.
   */
  listBrandAssets(clientId: string): BrandAsset[] {
    if (!this.mayRead('brand-project', clientId)) return [];
    return this.store.listBrandAssets(clientId);
  }

  getBrandAsset(id: string): BrandAsset | undefined {
    const asset = this.store.getBrandAsset(id);
    if (!asset || !this.mayRead('brand-project', asset.clientId)) return undefined;
    return asset;
  }

  saveBrandAsset(asset: BrandAsset): void {
    this.mustWrite('brand-project', asset.clientId);
    for (const id of assetsInBrandAsset(asset)) {
      const target = this.store.getAsset(id);
      // Checked against the store, not through `getAsset`: a studio is writing
      // here and must be able to attach a file it has not approved yet. What
      // still cannot happen is pointing at another client's asset, and that is
      // a `clientId` comparison rather than a visibility one.
      if (!target || target.clientId !== asset.clientId) {
        throw new Forbidden('write', { kind: 'brand-project', clientId: asset.clientId },
          'that file is not this client\'s');
      }
    }
    this.store.saveBrandAsset(asset);
  }

  deleteBrandAsset(id: string): void {
    const existing = this.store.getBrandAsset(id);
    if (!existing) return;
    this.mustWrite('brand-project', existing.clientId);
    this.store.deleteBrandAsset(id);
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

  /**
   * The added documents, under the same rules as the eight.
   *
   * `document` again rather than a new resource, for the reason the resource
   * list needs no new entry to say: a document in this library is the same
   * object to a client whichever shelf it arrived on. Giving the second kind
   * its own permission would mean a rule that reads one way and applies to half
   * the library.
   */
  listDocumentEntries(clientId: string): ClientDocumentEntry[] {
    if (!this.mayRead('document', clientId)) return [];
    return this.store.listDocumentEntries(clientId);
  }

  getDocumentEntry(id: string): ClientDocumentEntry | undefined {
    const entry = this.store.getDocumentEntry(id);
    if (!entry || !this.mayRead('document', entry.clientId)) return undefined;
    return entry;
  }

  /**
   * Add or revise a document.
   *
   * **The shape of the source is checked here, not by the caller's form.** A
   * Figma document must name a real Figma file and an upload must name a real
   * file of this client's, and both are refusals a client must not be able to
   * talk its way past by editing a request body. The check is a refusal, not a
   * silent repair: a document that arrived wrong is a mistake worth seeing.
   */
  saveDocumentEntry(entry: ClientDocumentEntry): void {
    this.mustWrite('document', entry.clientId);
    if (entry.source === 'figma' && !entry.sourceUrl) {
      throw new Forbidden('write', { kind: 'document', clientId: entry.clientId },
        'a Figma document needs a link');
    }
    if (entry.source === 'figma' && figmaUrlProblem(entry.sourceUrl ?? '')) {
      throw new Forbidden('write', { kind: 'document', clientId: entry.clientId },
        'that is not a Figma link');
    }
    if (entry.source === 'upload' && !entry.assetId) {
      throw new Forbidden('write', { kind: 'document', clientId: entry.clientId },
        'an uploaded document needs a file');
    }
    // A document that arrives claiming to be a link is also allowed to keep a
    // Figma URL, and an upload must not: the source is what says where the
    // bytes come from, and a row that says both is a row no later reader can
    // trust.
    if (entry.source === 'upload' && entry.sourceUrl) {
      throw new Forbidden('write', { kind: 'document', clientId: entry.clientId },
        'an uploaded document cannot also carry a link');
    }
    for (const id of [entry.assetId, entry.thumbnailAssetId]) {
      if (!id) continue;
      const target = this.store.getAsset(id);
      if (!target || target.clientId !== entry.clientId) {
        throw new Forbidden('write', { kind: 'document', clientId: entry.clientId },
          'that file is not this client\'s');
      }
    }
    this.store.saveDocumentEntry(entry);
  }

  deleteDocumentEntry(id: string): void {
    const existing = this.store.getDocumentEntry(id);
    if (!existing) return;
    this.mustWrite('document', existing.clientId);
    this.store.deleteDocumentEntry(id);
  }

  /**
   * A presentation's manifest, readable only through its document.
   *
   * The document is resolved first and its `clientId` is the one checked, so
   * there is no way to ask for pages by a document id belonging to somebody
   * else and get an empty list instead of a refusal — the id in the path is
   * never trusted on its own.
   */
  listDocumentPages(documentId: string): DocumentPage[] {
    const entry = this.getDocumentEntry(documentId);
    if (!entry) return [];
    return this.store.listDocumentPages(documentId);
  }

  /**
   * Replace a manifest, and refuse the two ways it could be wrong.
   *
   * The document must be this client's, and the orders must be 1..n with no
   * gaps: a manifest with two page fours, or pages four and seven, is one the
   * viewer would render with a control pointing at nothing. Normalising them
   * would be friendlier and would hide the mistake, so it is a refusal.
   */
  saveDocumentPages(documentId: string, pages: readonly DocumentPage[]): void {
    const entry = this.getDocumentEntry(documentId);
    if (!entry) {
      throw new Forbidden('write', { kind: 'document', clientId: '' },
        'no such document');
    }
    this.mustWrite('document', entry.clientId);
    if (entry.source !== 'figma') {
      throw new Forbidden('write', { kind: 'document', clientId: entry.clientId },
        'only a Figma document has pages');
    }
    const orders = pages.map((page) => page.order);
    const sequential = orders.length > 0
      && orders.every((order, index) => order === index + 1);
    if (!sequential) {
      throw new Forbidden('write', { kind: 'document', clientId: entry.clientId },
        'pages must be numbered 1 to n with no gaps');
    }
    this.store.saveDocumentPages(documentId, pages);
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

  /* ----------------------------------------------------------------- events */

  /**
   * The studio's calendar, as this session may see it.
   *
   * The one read that is not scoped to a named client, because an event may not
   * belong to one: the studio's own time is on the same calendar as a client's
   * kickoff. An event with a client is filtered by that client exactly as a
   * milestone is; an event without one is the studio's own, and is decided by
   * the same empty-string trick `support` notes use — a portal principal's scope
   * is a list of real client ids, so it never matches, and the studio's `'all'`
   * reaches the ordinary role check untouched.
   */
  listEvents(clientId?: string): Event[] {
    if (clientId !== undefined) {
      if (!this.mayRead('event', clientId)) return [];
      return this.store.listEventsForClient(clientId);
    }
    return this.store.listEvents().filter((event) => event.clientId === undefined
      ? this.mayRead('event', '')
      : this.mayRead('event', event.clientId));
  }

  getEvent(id: string): Event | undefined {
    const event = this.store.getEvent(id);
    if (!event) return undefined;
    const visible = event.clientId === undefined
      ? this.mayRead('event', '')
      : this.mayRead('event', event.clientId);
    return visible ? event : undefined;
  }

  saveEvent(event: Event): void {
    this.mustWrite('event', event.clientId ?? '');
    this.store.saveEvent(event);
  }

  deleteEvent(id: string): void {
    const existing = this.store.getEvent(id);
    if (!existing) return;
    this.mustWrite('event', existing.clientId ?? '');
    this.store.deleteEvent(id);
  }

  /* -------------------------------------------------------------- strategies */

  listStrategies(clientId: string): Strategy[] {
    if (!this.mayRead('strategy', clientId)) return [];
    return this.store.listStrategiesForClient(clientId);
  }

  getStrategy(id: string): Strategy | undefined {
    const strategy = this.store.getStrategy(id);
    if (!strategy) return undefined;
    return this.mayRead('strategy', strategy.clientId) ? strategy : undefined;
  }

  /**
   * Writing one is a studio act: the transcript is the client's words and the
   * page is the studio's reading of them, and a portal principal has no business
   * authoring either. The policy makes that explicit rather than relying on the
   * resource being absent from the client's collection, which is a list that
   * changes.
   */
  saveStrategy(strategy: Strategy): void {
    this.mustWrite('strategy', strategy.clientId);
    this.store.saveStrategy(strategy);
  }

  deleteStrategy(id: string): void {
    const existing = this.store.getStrategy(id);
    if (!existing) return;
    this.mustWrite('strategy', existing.clientId);
    this.store.deleteStrategy(id);
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

  /* --------------------------------------------------------------- contracts */

  listContracts(clientId: string): Contract[] {
    if (!this.mayRead('contract', clientId)) return [];
    return this.store.listContracts(clientId);
  }

  getContract(id: string): Contract | undefined {
    const existing = this.store.getContract(id);
    if (!existing || !this.mayRead('contract', existing.clientId)) return undefined;
    return existing;
  }

  saveContract(contract: Contract): void {
    this.mustWrite('contract', contract.clientId);
    this.store.saveContract(contract);
  }

  deleteContract(id: string): void {
    const existing = this.store.getContract(id);
    if (!existing) return;
    this.mustWrite('contract', existing.clientId);
    this.store.deleteContract(id);
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
