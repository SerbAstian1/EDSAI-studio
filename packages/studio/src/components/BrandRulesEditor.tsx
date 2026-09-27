import { useState, type ReactElement } from 'react';
import { Download, Palette, Plus, X } from 'lucide-react';
import type { BrandRules, BrandValue } from '../api.js';
import { allowedColors } from './brandModules.js';

/**
 * The rules that keep generated work inside the brand.
 *
 * **Every list here is "the designer named them", and an empty list means "fall
 * back to what the brand already has" rather than "nothing is allowed".** A hub
 * with no rules is not a hub with no colours — it is a hub whose generators use
 * the palette the run measured. That is the rule that makes this safe to ship
 * against every existing client: the default is unrestricted, and restricting is
 * something a designer does deliberately.
 *
 * The one exception is `allowCustomColor`, which is off unless asked for. A
 * client who can reach a hex field will use it, and a brand that allows a hex
 * field does not have a palette.
 */

export const EMPTY_RULES: BrandRules = {
  colors: [], allowCustomColor: false, fonts: [], allowCustomFont: false, exports: [],
};


const HEX = /^#[0-9a-f]{6}$/i;

/** Add a hex, lowercased, and refuse anything that is not one. */
export function addColor(rules: BrandRules, hex: string): BrandRules {
  const trimmed = hex.trim().toLowerCase();
  if (!HEX.test(trimmed) || rules.colors.includes(trimmed)) return rules;
  return { ...rules, colors: [...rules.colors, trimmed] };
}

export function removeColor(rules: BrandRules, hex: string): BrandRules {
  return { ...rules, colors: rules.colors.filter((c) => c !== hex) };
}

export default function BrandRulesEditor({ rules, values, onChange, disabled }: {
  rules: BrandRules;
  /** The brand's measured palette, offered as the things worth allowing. */
  values: readonly BrandValue[];
  onChange: (rules: BrandRules) => void;
  disabled?: boolean;
}): ReactElement {
  const [hex, setHex] = useState('');
  const [font, setFont] = useState('');
  const measured = values.filter((v) => v.kind === 'color');
  const measuredFonts = values.filter((v) => v.kind === 'font');
  const fallback = allowedColors({ ...rules, colors: [] }, values);

  return (
    <div className="card stack">
      <span className="label"><Palette size={13} aria-hidden="true" /> Rules every generator obeys</span>

      <div className="stack" style={{ gap: 8 }}>
        <span className="label">Colours allowed</span>
        {rules.colors.length === 0 ? (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Unrestricted — every generator uses the {fallback.hexes.length} colour
            {fallback.hexes.length === 1 ? '' : 's'} in the brand palette. Name colours here to hold a
            generator to three.
          </p>
        ) : (
          <div className="swatch-row">
            {rules.colors.map((c) => (
              <span key={c} className="swatch-pick on">
                <i style={{ background: c }} aria-hidden="true" />
                <span className="swatch-pick-label mono">{c.toUpperCase()}</span>
                <button type="button" aria-label={`Stop allowing ${c}`} disabled={disabled}
                        onClick={() => onChange(removeColor(rules, c))}>
                  <X size={11} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {measured
            .filter((v) => HEX.test(v.value.trim()))
            .filter((v) => !rules.colors.includes(v.value.trim().toLowerCase()))
            .map((v) => (
              <button key={v.name} type="button" disabled={disabled} title={`Allow ${v.name}`}
                      onClick={() => onChange(addColor(rules, v.value))}>
                <i style={{ background: v.value, width: 12, height: 12, borderRadius: 3, display: 'inline-block' }} aria-hidden="true" />
                {' '}{v.name}
              </button>
            ))}
        </div>
        <div className="row">
          <input value={hex} placeholder="#EB5E28" aria-label="A hex colour to allow"
                 onChange={(e) => setHex(e.target.value)}
                 onKeyDown={(e) => {
                   if (e.key !== 'Enter') return;
                   e.preventDefault();
                   onChange(addColor(rules, hex));
                   setHex('');
                 }} />
          <button type="button" disabled={disabled || !HEX.test(hex.trim())}
                  onClick={() => { onChange(addColor(rules, hex)); setHex(''); }}>
            <Plus size={14} aria-hidden="true" /> Allow
          </button>
        </div>
        <label className="choice">
          <input type="checkbox" checked={rules.allowCustomColor} disabled={disabled}
                 onChange={(e) => onChange({ ...rules, allowCustomColor: e.target.checked })} />
          <span>
            <strong>Let clients reach a colour that is not on this list</strong>
            <span className="why">Off by default. A client who can reach a hex field will use it.</span>
          </span>
        </label>
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <span className="label">Typefaces allowed</span>
        {rules.fonts.length === 0 ? (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Unrestricted — the brand&apos;s own {measuredFonts.length} typeface
            {measuredFonts.length === 1 ? '' : 's'}.
          </p>
        ) : (
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {rules.fonts.map((f) => (
              <span key={f} className="pill minor">
                {f}
                <button type="button" aria-label={`Stop allowing ${f}`} disabled={disabled}
                        onClick={() => onChange({ ...rules, fonts: rules.fonts.filter((x) => x !== f) })}>
                  <X size={11} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {measuredFonts
            .filter((v) => v.value.trim() && !rules.fonts.includes(v.value.trim()))
            .map((v) => (
              <button key={v.name} type="button" disabled={disabled}
                      onClick={() => onChange({ ...rules, fonts: [...rules.fonts, v.value.trim()] })}>
                {v.name}
              </button>
            ))}
        </div>
        <div className="row">
          <input value={font} placeholder="A typeface name" aria-label="A typeface to allow"
                 onChange={(e) => setFont(e.target.value)}
                 onKeyDown={(e) => {
                   if (e.key !== 'Enter') return;
                   e.preventDefault();
                   if (font.trim()) onChange({ ...rules, fonts: [...rules.fonts, font.trim()] });
                   setFont('');
                 }} />
          <button type="button" disabled={disabled || font.trim() === ''}
                  onClick={() => { onChange({ ...rules, fonts: [...rules.fonts, font.trim()] }); setFont(''); }}>
            <Plus size={14} aria-hidden="true" /> Allow
          </button>
        </div>
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <span className="label"><Download size={12} aria-hidden="true" /> Export formats</span>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Naming formats here narrows every tool&apos;s export buttons to those it can actually
          produce. A format a tool cannot make is never granted by naming it.
        </p>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {['png', 'svg', 'pdf', 'jpg'].map((format) => (
            <label key={format} className="choice">
              <input
                type="checkbox"
                checked={rules.exports.includes(format)}
                disabled={disabled}
                onChange={() => onChange({
                  ...rules,
                  exports: rules.exports.includes(format)
                    ? rules.exports.filter((f) => f !== format)
                    : [...rules.exports, format],
                })}
              />
              <span className="mono">{format.toUpperCase()}</span>
            </label>
          ))}
        </div>
        {rules.exports.length === 0 && (
          <span className="muted" style={{ fontSize: 12 }}>Unrestricted — each tool offers what it makes.</span>
        )}
      </div>
    </div>
  );
}
