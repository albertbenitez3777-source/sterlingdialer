// v248 — Canonical script compliance: all Bland call-creation paths
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const DIALER = readFileSync(join(ROOT, 'supabase', 'functions', 'wolf-dialer-loop', 'index.ts'), 'utf-8');
const PROVIDER = readFileSync(join(ROOT, 'supabase', 'functions', 'wolf-provider', 'index.ts'), 'utf-8');
const INBOUND = readFileSync(join(ROOT, 'supabase', 'functions', 'wolf-configure-inbound', 'index.ts'), 'utf-8');
const WEBHOOK = readFileSync(join(ROOT, 'supabase', 'functions', 'wolf-webhook', 'index.ts'), 'utf-8');

function extractTemplateLiterals(src: string): string[] {
  const matches: string[] = [];
  const regex = /`[^`]*`/g;
  let m;
  while ((m = regex.exec(src)) !== null) { matches.push(m[0]); }
  return matches;
}

function extractFirstSentences(src: string): string[] {
  return extractTemplateLiterals(src).filter(t =>
    (t.toLowerCase().includes('this is elizabeth') || t.includes('Hi ') || t.includes('Hi,')) &&
    !t.includes('Never claim') && !t.includes('NEVER claim') && !t.includes('Never disclose')
  );
}

const ALL_SCRIPTS = [DIALER, PROVIDER, INBOUND];
const SCRIPT_LABELS = ['wolf-dialer-loop', 'wolf-provider', 'wolf-configure-inbound'];

describe('v248 Canonical Script Compliance', () => {
  describe('Canonical first_sentence', () => {
    const dialerFS = extractFirstSentences(DIALER);
    const providerFS = extractFirstSentences(PROVIDER);

    it('dialer: "Elizabeth" identification', () => { expect(dialerFS.some(s => s.toLowerCase().includes('this is elizabeth'))).toBe(true); });
    it('dialer: "Sterling Collections"', () => { expect(dialerFS.some(s => s.includes('Sterling Collections'))).toBe(true); });
    it('dialer: asks for person or availability', () => { expect(dialerFS.some(s => s.toLowerCase().includes('are you available') || s.toLowerCase().includes('may i speak'))).toBe(true); });
    it('provider: "Elizabeth calling"', () => { expect(providerFS.some(s => s.toLowerCase().includes('this is elizabeth calling'))).toBe(true); });
    it('provider: "Sterling Collections"', () => { expect(providerFS.some(s => s.includes('Sterling Collections'))).toBe(true); });
    it('provider first_sentences: no "case agent"', () => { expect(providerFS.every(s => !s.includes('case agent'))).toBe(true); });
    it('provider first_sentences: no "urgent legal matter"', () => { expect(providerFS.every(s => !s.includes('urgent legal matter'))).toBe(true); });
    it('provider first_sentences: no "on the other line"', () => { expect(providerFS.every(s => !s.includes('on the other line'))).toBe(true); });
    it('provider first_sentences: no "deadline"', () => { expect(providerFS.every(s => !s.includes('deadline'))).toBe(true); });
    it('provider first_sentences: no "lawsuit"', () => { expect(providerFS.every(s => !s.includes('lawsuit'))).toBe(true); });
  });

  describe('Exact transfer trigger', () => {
    ALL_SCRIPTS.forEach((src, i) => {
      it(`${SCRIPT_LABELS[i]}: "Connecting you now" present`, () => { expect(src).toContain('Connecting you now'); });
    });
  });

  describe('No forbidden claims in spoken text', () => {
    const allFS = [...extractFirstSentences(DIALER), ...extractFirstSentences(PROVIDER), ...extractFirstSentences(INBOUND)];
    const FORBIDDEN_IN_SPEECH = ['urgent legal matter', 'case agent', 'lawsuit', 'deadline', 'on the other line right now', 'on the other line', 'APPLY PRESSURE', 'PERSISTENCE RULE', 'agent in charge of your case'];
    FORBIDDEN_IN_SPEECH.forEach(phrase => {
      it(`no first_sentence contains "${phrase}"`, () => { expect(allFS.every(s => !s.includes(phrase))).toBe(true); });
    });
  });

  describe('Silence and voicemail', () => {
    it('dialer: voicemail action = hangup', () => { expect(DIALER.includes('"action": "hangup"') || DIALER.includes('action: "hangup"')).toBe(true); });
    it('provider: voicemail action = hangup', () => { expect(PROVIDER.includes('"action": "hangup"') || PROVIDER.includes('action: "hangup"')).toBe(true); });
    it('dialer: hangs up on silence', () => { expect(DIALER.includes('line is silent') || DIALER.includes('no reply within 5 seconds')).toBe(true); });
    it('provider: hangs up on silence', () => { expect(PROVIDER.includes('line is silent') || PROVIDER.includes('no reply within 5 seconds')).toBe(true); });
    ALL_SCRIPTS.forEach((src, i) => {
      it(`${SCRIPT_LABELS[i]}: voicemail detection`, () => { expect(src.includes('voicemail') || src.includes('answering machine')).toBe(true); });
      it(`${SCRIPT_LABELS[i]}: hangs up on voicemail`, () => { expect(src.includes('HANG UP') || src.includes('hangup')).toBe(true); });
    });
  });

  describe('Human reply flow', () => {
    ALL_SCRIPTS.forEach((src, i) => {
      it(`${SCRIPT_LABELS[i]}: waits for reply`, () => { expect(src.includes('WAIT up to 3 seconds') || src.includes('WAIT up to')).toBe(true); });
    });
  });

  describe('No post-transfer speech', () => {
    ALL_SCRIPTS.forEach((src, i) => {
      it(`${SCRIPT_LABELS[i]}: silence after trigger`, () => { expect(src.includes('Then say NOTHING') || src.includes('say NOTHING')).toBe(true); });
    });
  });

  describe('Talkroute destination', () => {
    it('dialer: passes talkroute', () => { expect(DIALER).toContain('transfer_phone_number: transferNumber'); });
    it('provider: passes talkroute', () => { expect(PROVIDER).toContain('transfer_phone_number: transferNumber'); });
  });

  describe('Bridge-proof predicate', () => {
    it('webhook: checks representative speech', () => { expect(WEBHOOK).toContain('hasRepresentativeSpeech'); });
    it('webhook: checks MERGED state', () => { expect(WEBHOOK).toContain('MERGED'); });
  });

  describe('Redial scripts clean', () => {
    const providerLower = PROVIDER.toLowerCase();
    it('no "APPLY MORE PRESSURE"', () => { expect(providerLower).not.toContain('apply more pressure'); });
    it('no "PERSISTENCE RULE"', () => { expect(providerLower).not.toContain('persistence rule'); });
    it('no "do not give up easily"', () => { expect(providerLower).not.toContain('do not give up easily'); });
    it('no "a soft no"', () => { expect(providerLower).not.toContain('a soft no'); });
    it('no "senior case agent"', () => { expect(providerLower).not.toContain('senior case agent'); });
    it('no "professional legal assistant"', () => { expect(providerLower).not.toContain('professional legal assistant'); });
    it('no voicemail with transfer number', () => { expect(providerLower).not.toContain('call him back at'); });
  });

  describe('Inbound script canonical', () => {
    it('inbound: no "Elizabeth Sterling"', () => { expect(INBOUND).not.toContain('Elizabeth Sterling'); });
    it('inbound: no "agent in charge"', () => { expect(INBOUND).not.toContain('agent in charge of your case'); });
    it('inbound: uses "Elizabeth"', () => { expect(INBOUND).toContain('this is Elizabeth'); });
  });

  describe('Debt disclosure prohibited', () => {
    ALL_SCRIPTS.forEach((src, i) => {
      it(`${SCRIPT_LABELS[i]}: prohibits disclosure`, () => { expect(src.includes('Never disclose') || src.includes('NEVER claim')).toBe(true); });
    });
  });

  describe('wait_for_greeting', () => {
    it('dialer: enabled', () => { expect(DIALER).toContain('wait_for_greeting: true'); });
    it('provider: enabled', () => { expect(PROVIDER).toContain('wait_for_greeting: true'); });
  });
});
