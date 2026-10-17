// Kairos UI translations.
//
// English text is the key: tr("Save") returns "Save" in English and the Hebrew
// entry from i18n.he.js when the language is Hebrew. A string with no Hebrew
// entry simply stays in English, so a missing translation never breaks a screen.
//
// Language is remembered in this browser (localStorage) and, once logged in, on
// the user's record too (see App.jsx) so the server can send Hebrew e-mails and
// notifications to people who chose Hebrew.
import he from "./i18n.he";

const KEY      = "kairos_lang";
const EXPLICIT = "kairos_lang_explicit";   // set when the user picked a language on this device

function readStored() {
  try { return localStorage.getItem(KEY) === "he" ? "he" : "en"; } catch { return "en"; }
}

let lang = readStored();

export const getLang = () => lang;
export const isHe    = () => lang === "he";
export const hasExplicitChoice = () => { try { return localStorage.getItem(EXPLICIT) === "1"; } catch { return false; } };

// Page direction follows the language. <html dir> is what flips the whole layout.
export function applyDocLang() {
  const root = document.documentElement;
  root.setAttribute("lang", lang);
  root.setAttribute("dir", lang === "he" ? "rtl" : "ltr");
}

export function setLang(next, explicit = true) {
  lang = next === "he" ? "he" : "en";
  try {
    localStorage.setItem(KEY, lang);
    if (explicit) localStorage.setItem(EXPLICIT, "1");
  } catch {}
  applyDocLang();
}

// tr("Hello {name}", { name }) — {placeholders} work in both languages.
export function tr(text, params) {
  let s = lang === "he" ? (he.ui[text] ?? text) : text;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? params[k] : m));
  return s;
}

// Values the server stores as codes (status, priority, role, field type).
// English keeps whatever formatting the call site already used (fallback).
export function trVal(kind, value, fallback) {
  const plain = fallback !== undefined ? fallback : value;
  if (lang !== "he") return plain;
  const table = he[kind];
  return (table && table[value]) || plain;
}

applyDocLang();
