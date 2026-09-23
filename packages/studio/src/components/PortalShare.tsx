import { useState, type ReactElement } from 'react';
import { Copy, Mail, MessageCircle, Share2 } from 'lucide-react';
import type { Contact } from '../api.js';

export interface PortalAccessInvite {
  label: string;
  accessCode: string;
  accessUrl: string;
  expiresAt: string;
}

interface PortalShareProps {
  clientName: string;
  contacts: Contact[];
  invite: PortalAccessInvite;
}

function expiryLabel(expiresAt: string): string {
  return new Date(expiresAt).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

export function portalAccessMessage(
  clientName: string,
  invite: PortalAccessInvite,
): string {
  return [
    `Hello ${invite.label},`,
    '',
    `The studio has shared private EDSAI access for ${clientName}.`,
    `Access URL: ${invite.accessUrl}`,
    `Access code: ${invite.accessCode}`,
    '',
    `This code can be used once and expires on ${expiryLabel(invite.expiresAt)}. Keep it private.`,
  ].join('\n');
}

export function emailShareUrl(email: string, subject: string, message: string): string {
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
}

export function whatsAppShareUrl(phone: string, message: string): string | undefined {
  const number = phone.replace(/[^\d]/g, '');
  if (number.length < 7) return undefined;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

function recipientLabel(contact: Contact): string {
  const methods = [contact.email && 'email', contact.phone && 'WhatsApp'].filter(Boolean);
  return `${contact.name} (${methods.join(', ')})`;
}

export default function PortalShare({ clientName, contacts, invite }: PortalShareProps): ReactElement {
  const shareableContacts = contacts.filter((contact) => contact.email || contact.phone);
  const defaultRecipient = shareableContacts.find((contact) => contact.decisionMaker) ?? shareableContacts[0];
  const [recipientId, setRecipientId] = useState(defaultRecipient?.id ?? '');
  const [copied, setCopied] = useState(false);
  const recipient = shareableContacts.find((contact) => contact.id === recipientId) ?? defaultRecipient;
  const message = portalAccessMessage(clientName, invite);
  const subject = `Your EDSAI access for ${clientName}`;
  const emailUrl = recipient?.email ? emailShareUrl(recipient.email, subject, message) : undefined;
  const whatsappUrl = recipient?.phone ? whatsAppShareUrl(recipient.phone, message) : undefined;

  const copyInvitation = (): void => {
    if (!navigator.clipboard) return;
    void navigator.clipboard.writeText(message).then(() => setCopied(true), () => setCopied(false));
  };

  const shareInvitation = (): void => {
    if (!navigator.share) {
      copyInvitation();
      return;
    }
    void navigator.share({ title: subject, text: message, url: invite.accessUrl });
  };

  return (
    <div className="portal-share stack">
      <div>
        <span className="label">Client access code</span>
        <p className="mono portal-access-code">{invite.accessCode}</p>
      </div>

      <div className="row">
        <button type="button" className="primary" onClick={shareInvitation}>
          <Share2 size={14} strokeWidth={1.9} aria-hidden="true" />
          Share access
        </button>
        <button type="button" onClick={copyInvitation}>
          <Copy size={14} strokeWidth={1.9} aria-hidden="true" />
          {copied ? 'Copied invitation' : 'Copy invitation'}
        </button>
      </div>

      {shareableContacts.length > 0 ? (
        <>
          <label className="field">
            <span className="label">Send to</span>
            <select value={recipient?.id ?? ''} onChange={(event) => setRecipientId(event.target.value)}>
              {shareableContacts.map((contact) => (
                <option key={contact.id} value={contact.id}>{recipientLabel(contact)}</option>
              ))}
            </select>
          </label>

          <div className="row">
            <button type="button" disabled={!emailUrl} onClick={() => {
              if (emailUrl) location.href = emailUrl;
            }}>
              <Mail size={14} strokeWidth={1.9} aria-hidden="true" />
              Email invite
            </button>
            <button type="button" disabled={!whatsappUrl} onClick={() => {
              if (whatsappUrl) window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
            }}>
              <MessageCircle size={14} strokeWidth={1.9} aria-hidden="true" />
              WhatsApp invite
            </button>
          </div>
        </>
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          Add a client contact with an email address or WhatsApp number to send this invitation directly.
        </p>
      )}

      <p className="muted" style={{ margin: 0 }}>
        Email and WhatsApp open a draft for you to review and send. This access code is shown once and cannot be reused.
      </p>
    </div>
  );
}
