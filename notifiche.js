import { getNotifiche } from "./api.js";
import { isConfigured } from "./config.js";

/**
 * La BACHECA DELLE NOTIFICHE (dal 02/10/2026, PWA v24).
 *
 * ⛔ Perche' esiste — 29/09/2026, Giorgio: «vedo solo la notifica singola con testo limitato e
 * niente dentro a Kirk». Fino alla v23 ogni push cancellava la precedente (un tag solo) e il PC
 * non conservava nulla. Ora il PC scrive ogni notifica in un registro PRIMA di spedirla
 * (data/notifiche.jsonl) e questa bacheca lo legge: ultimi 30 giorni, testo intero.
 *
 * Regole di costruzione:
 *  - SOLO LETTURA (risposta 1 di Giorgio): nessuna azione da qui, le fa Remote Control.
 *  - La fonte e' il PC (risposta 2): senza collegamento la bacheca lo dice e basta.
 *  - Testo SEMPRE come testo (textContent), MAI innerHTML: alcune notifiche portano parole di
 *    persone esterne (le risposte del Forum) e in questa pagina vive il token.
 *  - Il segno «gia' visto» vive qui (localStorage): se manca, tutto risulta gia' visto —
 *    nessuna valanga di pallini dopo una memoria cancellata.
 *  - Nessun polling (Regola 15): il pallino si aggiorna al collegamento col PC, a ogni push
 *    (messaggio del service worker) e al ritorno in primo piano.
 */

const CHIAVE_VISTO = "kirk_notifiche_visto_fino";
const ESITI_KO = new Set(["nessuna_iscrizione", "iscrizione_scaduta", "troppo_lunga", "errore"]);
const MSG_PC = "PC non raggiungibile — la bacheca si legge quando Kirk raggiunge il PC";

const _el = {};
let _ultime = [];            // l'ultima lista del PC, dalla piu' recente
let _vistoAllApertura = 0;   // il segno di PRIMA: evidenzia le nuove finche' la bacheca e' aperta
let _abilitaNotifiche = null;
let _generazione = 0;        // ogni apertura/chiusura della bacheca invalida le risposte ancora in volo

export function inizializzaNotifiche({ abilitaNotifiche } = {}) {
  _abilitaNotifiche = abilitaNotifiche || null;
  _el.btn = document.getElementById("notif-btn");
  _el.pallino = document.getElementById("notif-pallino");
  _el.pannello = document.getElementById("notifiche-panel");
  _el.chiudi = document.getElementById("notifiche-chiudi");
  _el.stato = document.getElementById("notifiche-stato");
  _el.lista = document.getElementById("notifiche-lista");

  _el.btn.addEventListener("click", _toccoCampanella);
  _el.chiudi.addEventListener("click", chiudiBacheca);
  document.getElementById("settings-btn")?.addEventListener("click", () => {
    if (!_el.pannello.classList.contains("hidden")) chiudiBacheca();   // un pannello alla volta
  });
  window.addEventListener("kirk:collegato", () => aggiornaPallino());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") aggiornaPallino();
  });
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (e) => {
      const d = (e && e.data) || {};
      if (d.tipo === "notifica") aggiornaPallino();
      else if (d.tipo === "apri-notifica") apriBacheca(d.id || null);
    });
  }
}

function _toccoCampanella() {
  const push = "Notification" in window && "PushManager" in window;
  if (push && Notification.permission === "default" && _abilitaNotifiche) {
    _abilitaNotifiche();       // il primo tocco chiede il permesso delle push, come fino alla v23
    return;
  }
  if (_el.pannello.classList.contains("hidden")) apriBacheca();
  else chiudiBacheca();
}

/** Chiede al PC la lista e accende il pallino con le non viste. Muto se il PC non risponde. */
export async function aggiornaPallino() {
  if (!isConfigured()) return;
  const mia = _generazione;
  let dati;
  try { dati = await getNotifiche(); } catch { return; }
  if (mia !== _generazione) return;   // la bacheca si è aperta o chiusa nel frattempo: decide la sua risposta
  _ultime = _lista(dati);
  const ultima = _ultime.length ? _ultime[0].ts : null;
  if (!_el.pannello.classList.contains("hidden")) {
    // Bacheca aperta: cio' che arriva adesso Giorgio lo sta guardando.
    if (_vistoAllApertura === null) _vistoAllApertura = ultima ?? 0;
    if (ultima !== null) _salvaVisto(Math.max(ultima, _leggiVisto() ?? 0));
    _disegnaPallino(0);
    const aperte = new Set([..._el.lista.querySelectorAll("li.notifica.aperta")].map((li) => li.dataset.id));
    _disegnaLista(_vistoAllApertura, null, aperte);
    return;
  }
  let visto = _leggiVisto();
  if (visto === null) {          // primo avvio o memoria cancellata: tutto gia' visto
    visto = ultima ?? 0;
    _salvaVisto(visto);
  }
  _disegnaPallino(_ultime.filter((n) => n.ts > visto).length);
}

/** Apre la bacheca; con `idDaAprire` la apre gia' su quella notifica (tocco sulla push). */
export async function apriBacheca(idDaAprire = null) {
  // M7 (01/10/2026, giro di correzioni 1): stessa guardia di chiudiBacheca. Raggiungibile da
  // apriDaIndirizzo() col tocco su una push «?notifica=» quando la bacheca non e' mai partita
  // (versioni mescolate) — senza, il TypeError qui sotto esce non gestito da init() in app.js.
  if (!_el.pannello) return;
  const eraChiusa = _el.pannello.classList.contains("hidden");
  const mia = ++_generazione;
  if (eraChiusa) {
    // Il segno «di prima» si fissa ADESSO, prima di ogni attesa: una risposta che arriva mentre la
    // bacheca si carica non deve spostarlo. null = segno assente (si decide quando arriva la lista).
    _vistoAllApertura = _leggiVisto();
  }
  document.getElementById("settings-panel")?.classList.add("hidden");   // un pannello alla volta
  _el.pannello.classList.remove("hidden");
  _el.lista.replaceChildren();
  if (!isConfigured()) { _stato("Configura URL e token in ⚙️"); return; }
  _stato("Carico le notifiche dal PC…");
  let dati;
  try {
    dati = await getNotifiche();
  } catch (e) {
    if (mia !== _generazione) return;
    const msg = String((e && e.message) || "");
    _stato(e instanceof TypeError ? MSG_PC
         : /token/i.test(msg) ? "Token non valido: apri ⚙️"
         : `Il PC risponde: ${msg || "errore"}`);
    return;
  }
  if (mia !== _generazione || _el.pannello.classList.contains("hidden")) return;
  _ultime = _lista(dati);
  const ultima = _ultime.length ? _ultime[0].ts : null;
  if (_vistoAllApertura === null) _vistoAllApertura = ultima ?? 0;   // segno assente: tutto già visto
  if (ultima !== null) _salvaVisto(Math.max(ultima, _leggiVisto() ?? 0));
  _disegnaPallino(0);
  _disegnaLista(_vistoAllApertura, idDaAprire);
}

export function chiudiBacheca() {
  // M3 (01/10/2026): se inizializzaNotifiche non e' mai partita (versioni mescolate: index.html
  // senza il pannello, app.js nuovo) _el.pannello e' null — niente da chiudere, ed e' importante
  // uscire senza eccezioni: chi chiama (_verificaCollegamento in app.js) la racchiude in un
  // try/catch che altrimenti scambierebbe questo TypeError per un PC irraggiungibile.
  if (!_el.pannello) return;
  _generazione++;   // le risposte ancora in volo non spostano più il segno
  _el.pannello.classList.add("hidden");
  _vistoAllApertura = _leggiVisto() ?? 0;
}

/** All'avvio da «/kirk-webapp/?notifica=<id>» (tocco su una push con Kirk chiuso). */
export function apriDaIndirizzo() {
  const id = new URLSearchParams(location.search).get("notifica");
  if (!id) return false;
  history.replaceState(null, "", location.pathname);
  apriBacheca(id);
  return true;
}

function _lista(dati) {
  const l = Array.isArray(dati && dati.notifiche) ? dati.notifiche : [];
  return l.filter((n) => n && typeof n.ts === "number").sort((a, b) => b.ts - a.ts);
}

function _disegnaLista(visto, idDaAprire, aperte = new Set()) {
  _el.lista.replaceChildren();
  if (!_ultime.length) { _stato("Nessuna notifica negli ultimi 30 giorni."); return; }
  _stato("");
  let giorno = null;
  let daAprire = null;
  for (const n of _ultime) {
    const quando = new Date(n.ts * 1000);
    const etichetta = _etichettaGiorno(quando);
    if (etichetta !== giorno) {
      giorno = etichetta;
      const h = document.createElement("li");
      h.className = "not-giorno";
      h.textContent = etichetta;
      _el.lista.appendChild(h);
    }
    const li = _riga(n, quando, visto);
    _el.lista.appendChild(li);
    if (aperte.has(li.dataset.id)) _apriRiga(li, true);
    if (idDaAprire && n.id === idDaAprire) daAprire = li;
  }
  if (idDaAprire) {
    if (daAprire) {
      _apriRiga(daAprire, true);
      daAprire.scrollIntoView({ block: "center" });
    } else {
      _stato("Quella notifica non è più in bacheca (più vecchia di 30 giorni?).");
    }
  }
}

function _riga(n, quando, visto) {
  const ko = ESITI_KO.has(n.esito);
  const ignoto = n.esito === "sconosciuto";
  const nuova = n.ts > visto;
  const li = document.createElement("li");
  li.className = "notifica" + (nuova ? " nuova" : "") + (ko ? " esito-ko" : "") + (ignoto ? " esito-ignoto" : "");
  li.dataset.id = String(n.id || "");
  const testo = String(n.testo || "");
  const riga = document.createElement("div");
  riga.className = "not-riga";
  riga.append(
    _span("not-segno", ko ? "⚠" : nuova ? "●" : ignoto ? "·" : ""),
    _span("not-ora", _hhmm(quando)),
    _span("not-fonte", String(n.fonte || "Kirk")),
    _span("not-inizio", testo.split("\n")[0]),
  );
  const intero = document.createElement("div");
  intero.className = "not-testo hidden";
  intero.textContent = testo;
  if (ko || ignoto) {
    const e = document.createElement("div");
    e.className = "not-esito";
    e.textContent = ko ? `⚠ push non partita (${n.esito}): il testo è comunque qui.`
                       : "Esito della push sconosciuto: il PC si è fermato fra la scrittura e l'invio?";
    intero.appendChild(e);
  }
  li.append(riga, intero);
  li.addEventListener("click", () => _apriRiga(li));
  return li;
}

function _apriRiga(li, aperta = null) {
  const t = li.querySelector(".not-testo");
  const apri = aperta === null ? t.classList.contains("hidden") : aperta;
  t.classList.toggle("hidden", !apri);
  li.classList.toggle("aperta", apri);
}

function _etichettaGiorno(d) {
  const oggi = new Date();
  const ieri = new Date(oggi.getFullYear(), oggi.getMonth(), oggi.getDate() - 1);
  if (_stessoGiorno(d, oggi)) return "Oggi";
  if (_stessoGiorno(d, ieri)) return "Ieri";
  return `${_due(d.getDate())}/${_due(d.getMonth() + 1)}`;
}

function _stessoGiorno(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function _due(n) { return String(n).padStart(2, "0"); }

function _hhmm(d) { return `${_due(d.getHours())}:${_due(d.getMinutes())}`; }

function _span(classe, testo) {
  const s = document.createElement("span");
  s.className = classe;
  s.textContent = testo;
  return s;
}

function _stato(testo) { _el.stato.textContent = testo; }

function _disegnaPallino(n) {
  _el.pallino.textContent = n > 9 ? "9+" : n > 0 ? String(n) : "";
  _el.pallino.classList.toggle("hidden", n <= 0);
}

function _leggiVisto() {
  try {
    const v = parseFloat(localStorage.getItem(CHIAVE_VISTO));
    return Number.isFinite(v) ? v : null;
  } catch { return null; }
}

function _salvaVisto(ts) {
  try { localStorage.setItem(CHIAVE_VISTO, String(ts)); } catch { /* memoria negata: pazienza */ }
}
