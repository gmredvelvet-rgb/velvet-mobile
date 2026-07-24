/**
 * Velvet Mobile — License Client.
 *
 * Patreon OAuth, JWT token management, device fingerprinting, periodic
 * heartbeat and the world-level licence gate.
 *
 * The same Patreon subscription unlocks every VNE module, but each module
 * holds its own installation id and token set: the server registers each
 * one as a separate installation, and sharing token slots would clobber
 * the other modules' refresh-token rotation.
 *
 * Every sensitive operation (token issuance, subscription verification)
 * happens on the server. This file is only the client-side coordinator.
 *
 * @module license/license-client
 */

import { L10N, MODULE_ID, MODULE_TITLE } from "../core/constants.mjs";
import { Logger } from "../core/logger.mjs";

const API_BASE = "https://vnd-license.gmredvelvet.workers.dev";

/**
 * Module identifier sent to the licence server. It must be one the server
 * knows: it registers each module as its own installation, and rejects
 * auth codes issued for an unknown id ("Invalid or expired auth code").
 * Point this at whatever name the worker has registered for this module.
 */
const LICENSE_MODULE_ID = MODULE_ID;

/**
 * RSA public key (SPKI base64url) — safe to embed: forging a signature
 * requires the private key, which never leaves the server. Used to verify
 * RS256-signed responses and access-token claims. Rotate here and in
 * wrangler.toml (JWT_PUBLIC_KEY) together.
 */
const RSA_PUBLIC_KEY = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3-hTzuHo9lgENNQiA4-Fm7VIdalqisZ5NhqrBioXmIXSMbEhYpy1TnPkCBAdAzXAsyX1YdTYLcMADETPnERvceLsDoAWHFZzHGxoXBkOGw0ukAyHJyrwBZxCf_bY_FSbip_-XQuTS4YuyhLPVNjbGMZdVarkegh7BKwW4CR9MDb1DMtf_NxtfNqJ3MxhfAiTxIod4AWer8esisr0IekQlPLmMPA2KggzQw9rFj61B4DAVk2F_TAXPMOKyEcX_zVGpp00JTurTsfwK2023UHKO9t98R0rG17oX0rK_x2EOBiW2Nla3NChZyR4yi8zHe0vjYhprqcwozv9wN0wbANnzwIDAQAB";

/** localStorage keys, namespaced to this module. */
const SK = Object.freeze({
  accessToken: `${MODULE_ID}:at`,
  refreshToken: `${MODULE_ID}:rt`,
  tokenExpiry: `${MODULE_ID}:exp`,
  installationId: `${MODULE_ID}:iid`,
  tier: `${MODULE_ID}:tier`,
  features: `${MODULE_ID}:features`
});

/** Heartbeat cadence and the outage tolerance before locking down. */
const HEARTBEAT_MS = 15 * 60 * 1000;
const FIRST_HEARTBEAT_MS = 60 * 1000;
const GRACE_MS = 5 * 60 * 1000;

/** @param {string} key @param {object} [data] */
const L = (key, data) => (data
  ? game.i18n.format(`${L10N}.License.${key}`, data)
  : game.i18n.localize(`${L10N}.License.${key}`));

export class LicenseError extends Error {
  /** @param {string} message @param {string} code */
  constructor(message, code) {
    super(message);
    this.name = "LicenseError";
    this.code = code;
  }
}

export class LicenseClient {
  /** @type {LicenseClient|null} */
  static #instance = null;

  #accessToken = null;
  #refreshToken = null;
  #tokenExpiry = 0;
  #installationId = null;
  #fingerprint = null;
  #features = [];
  #tier = "none";
  #heartbeatTimer = null;
  #firstHeartbeatTimer = null;
  #lastHeartbeat = 0;
  #degraded = false;
  #rsaKey = null;

  /** @returns {LicenseClient} */
  static get instance() {
    LicenseClient.#instance ??= new LicenseClient();
    return LicenseClient.#instance;
  }

  /* -- Public surface ------------------------------------------------------ */

  /**
   * Restore a stored licence, refreshing the token when needed.
   * @returns {Promise<boolean>} Whether this installation is licensed.
   */
  async initialize() {
    this.#installationId = this.#getOrCreateInstallationId();
    this.#fingerprint = await this.#computeFingerprint();
    this.#loadStoredTokens();

    if (this.#accessToken && this.#isAccessTokenValid()) {
      try {
        const claims = await this.#verifyJwt(this.#accessToken);
        this.#tier = claims.tier ?? "none";
        this.#features = claims.features ?? [];
      } catch (err) {
        Logger.warn("Stored licence token rejected", err);
        this.#clearStoredTokens();
        return false;
      }
      this.#startHeartbeat();
      return true;
    }

    if (this.#refreshToken) {
      try {
        await this.#refresh();
        this.#startHeartbeat();
        return true;
      } catch (err) {
        // A transient outage must never destroy a valid licence: keep the
        // tokens so the heartbeat can recover once the server is back.
        if (this.#isTransient(err)) {
          Logger.warn("Licence server unreachable — keeping stored credentials", err);
          this.#startHeartbeat();
          return false;
        }
        Logger.warn("Licence refresh definitively rejected", err);
        this.#clearStoredTokens();
      }
    }
    return false;
  }

  /** @returns {string} */
  get tier() {
    return this.#tier;
  }

  /** @returns {boolean} */
  get isLicensed() {
    return this.#tier !== "none" && !this.#degraded;
  }

  /** @returns {string|null} */
  get installationId() {
    return this.#installationId;
  }

  /**
   * @returns {boolean} True when a refresh token exists, so auto-recovery is
   * possible and the re-auth prompt should stay hidden during an outage.
   */
  get hasStoredCredentials() {
    return Boolean(this.#refreshToken);
  }

  /** @param {string} feature @returns {boolean} */
  hasFeature(feature) {
    if (this.#degraded || !this.#isAccessTokenValid()) return false;
    return this.#features.includes(feature);
  }

  /**
   * Open the Patreon consent popup and activate on success.
   * @returns {Promise<boolean>} False when the user closed the popup.
   */
  async startOAuth() {
    const { url } = await this.#apiCall("/oauth/start", {
      origin: globalThis.location.origin,
      moduleId: LICENSE_MODULE_ID
    });
    const popup = window.open(url, "vnd-patreon-auth", "width=600,height=700,popup=yes");

    return new Promise((resolve, reject) => {
      const expectedOrigin = new URL(API_BASE).origin;
      let interval = null;

      const handler = async (event) => {
        if (event.origin !== expectedOrigin || event.data?.type !== "vnd-auth-code") return;
        window.removeEventListener("message", handler);
        if (interval) clearInterval(interval);
        const { authCode } = event.data;
        popup?.close();
        try {
          await this.activateWithCode(authCode);
          resolve(true);
        } catch (err) {
          // Carry the code out with the failure: it is single-use and
          // short-lived, so losing it here would force the whole Patreon
          // round trip again. The UI offers it back for a retry.
          err.authCode = authCode;
          reject(err);
        }
      };
      window.addEventListener("message", handler);

      // Popups are blocked or dismissed often on mobile: resolve rather than
      // hang forever so the caller can restore its button.
      interval = setInterval(() => {
        if (!popup?.closed) return;
        clearInterval(interval);
        // The message can still be in flight when the popup closes, so give
        // it a moment before declaring the flow cancelled.
        setTimeout(() => {
          window.removeEventListener("message", handler);
          resolve(false);
        }, 1500);
      }, 1000);
    });
  }

  /**
   * Exchange an auth code for tokens and unlock the world.
   * @param {string} authCode
   */
  async activateWithCode(authCode) {
    const result = await this.#apiCall("/oauth/exchange", {
      authCode,
      installationId: this.#installationId,
      fingerprintHash: this.#fingerprint,
      moduleId: LICENSE_MODULE_ID
    });

    this.#storeTokens(result);
    this.#degraded = false;
    this.#startHeartbeat();
    await this.#setWorldLicensed(true);
    ui.notifications?.info(`${MODULE_TITLE}: ${L("Connected", { tier: result.tier })}`);
  }

  /** Free this installation slot so it can be used on another device. */
  async releaseInstallation() {
    try {
      await this.#apiCall("/license/release", { installationId: this.#installationId });
      this.#clearStoredTokens();
      this.#stopHeartbeat();
      await this.#setWorldLicensed(false);
      ui.notifications?.info(`${MODULE_TITLE}: ${L("Released")}`);
      return true;
    } catch (err) {
      ui.notifications?.error(`${MODULE_TITLE}: ${err.message}`);
      return false;
    }
  }

  /* -- Token storage ------------------------------------------------------- */

  #loadStoredTokens() {
    this.#accessToken = localStorage.getItem(SK.accessToken);
    this.#refreshToken = localStorage.getItem(SK.refreshToken);
    this.#tokenExpiry = Number.parseInt(localStorage.getItem(SK.tokenExpiry) ?? "0", 10);
    this.#tier = localStorage.getItem(SK.tier) ?? "none";
    try {
      const parsed = JSON.parse(localStorage.getItem(SK.features) ?? "[]");
      this.#features = Array.isArray(parsed) ? parsed : [];
    } catch {
      this.#features = [];
    }
  }

  /** @param {object} result Server payload with tokens and entitlements. */
  #storeTokens({ accessToken, refreshToken, expiresIn, tier, features }) {
    const expiry = Date.now() + (expiresIn ?? 0) * 1000;
    this.#accessToken = accessToken;
    if (refreshToken) this.#refreshToken = refreshToken;
    this.#tokenExpiry = expiry;
    this.#tier = tier ?? "none";
    this.#features = features ?? [];

    localStorage.setItem(SK.accessToken, accessToken);
    if (refreshToken) localStorage.setItem(SK.refreshToken, refreshToken);
    localStorage.setItem(SK.tokenExpiry, String(expiry));
    localStorage.setItem(SK.tier, this.#tier);
    localStorage.setItem(SK.features, JSON.stringify(this.#features));
  }

  #clearStoredTokens() {
    this.#accessToken = null;
    this.#refreshToken = null;
    this.#tokenExpiry = 0;
    this.#tier = "none";
    this.#features = [];
    for (const key of Object.values(SK)) {
      if (key !== SK.installationId) localStorage.removeItem(key);
    }
  }

  /** @returns {boolean} */
  #isAccessTokenValid() {
    return Boolean(this.#accessToken) && this.#tokenExpiry > Date.now() + 60_000;
  }

  #getOrCreateInstallationId() {
    let id = localStorage.getItem(SK.installationId);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(SK.installationId, id);
    }
    return id;
  }

  /* -- Heartbeat ------------------------------------------------------------ */

  #startHeartbeat() {
    this.#stopHeartbeat();
    this.#lastHeartbeat = Date.now();
    this.#firstHeartbeatTimer = setTimeout(() => {
      this.#firstHeartbeatTimer = null;
      this.#heartbeat();
    }, FIRST_HEARTBEAT_MS);
    this.#heartbeatTimer = setInterval(() => this.#heartbeat(), HEARTBEAT_MS);
  }

  #stopHeartbeat() {
    if (this.#firstHeartbeatTimer) clearTimeout(this.#firstHeartbeatTimer);
    if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer);
    this.#firstHeartbeatTimer = this.#heartbeatTimer = null;
  }

  async #heartbeat() {
    try {
      const result = await this.#apiCall("/heartbeat", {
        installationId: this.#installationId,
        fingerprintHash: this.#fingerprint
      });
      this.#storeTokens({ ...result, refreshToken: null });
      this.#lastHeartbeat = Date.now();
      if (this.#degraded) {
        this.#degraded = false;
        await this.#setWorldLicensed(true);
      }
    } catch (err) {
      this.#onHeartbeatFailure(err);
    }
  }

  /** @param {Error} err */
  #onHeartbeatFailure(err) {
    // Definitive rejections lock down immediately; outages get the grace
    // period, because a flaky connection must not interrupt a session.
    const definitive = !this.#isTransient(err);
    const expired = Date.now() - this.#lastHeartbeat > GRACE_MS;
    if (!definitive && !expired) return;
    if (this.#degraded) return;

    this.#degraded = true;
    Logger.warn("Licence heartbeat failed", err);
    if (!game.user?.isGM) return;
    this.#setWorldLicensed(false);
    ui.notifications?.warn(`${MODULE_TITLE}: ${L("Locked")}`);
  }

  /**
   * Transport hiccups are safe to retry and must never destroy tokens;
   * anything else is a verdict from the licence server.
   * @param {Error} err
   * @returns {boolean}
   */
  #isTransient(err) {
    if (!(err instanceof LicenseError)) return true;
    return ["NETWORK_ERROR", "INTERNAL_ERROR", "RATE_LIMITED", "NOT_FOUND", "API_ERROR"].includes(err.code);
  }

  /** @param {boolean} licensed */
  async #setWorldLicensed(licensed) {
    if (!game.user?.isGM) return;
    try {
      await game.settings.set(MODULE_ID, "worldLicensed", licensed);
    } catch (err) {
      Logger.warn("Could not persist the world licence flag", err);
    }
  }

  /* -- Transport ------------------------------------------------------------ */

  async #refresh() {
    const result = await this.#apiCall("/token/refresh", {
      refreshToken: this.#refreshToken,
      fingerprintHash: this.#fingerprint
    });
    this.#storeTokens(result);
  }

  /**
   * @param {string} endpoint
   * @param {object|null} body
   * @returns {Promise<object>}
   */
  async #apiCall(endpoint, body) {
    const init = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Installation-ID": this.#installationId ?? ""
      }
    };
    if (this.#accessToken) init.headers.Authorization = `Bearer ${this.#accessToken}`;
    if (body) init.body = JSON.stringify({ ...body, nonce: crypto.randomUUID(), timestamp: Date.now() });

    let response;
    try {
      response = await fetch(`${API_BASE}${endpoint}`, init);
    } catch (err) {
      throw new LicenseError(err?.message ?? "Network error", "NETWORK_ERROR");
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new LicenseError(err.error ?? `Request failed (${response.status})`, err.code ?? "API_ERROR");
    }

    const data = await response.json();
    if (data.sig && data.payload) {
      await this.#verifyResponse(data.payload, data.sig);
      return data.payload;
    }
    return data;
  }

  /* -- Signature verification ----------------------------------------------- */

  /** @param {string} value  base64url text @returns {Uint8Array} */
  static #decodeBase64Url(value) {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    return Uint8Array.from(atob(base64), (c) => c.codePointAt(0));
  }

  async #importRsaKey() {
    this.#rsaKey ??= await crypto.subtle.importKey(
      "spki",
      LicenseClient.#decodeBase64Url(RSA_PUBLIC_KEY),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    return this.#rsaKey;
  }

  /**
   * @param {string} token
   * @returns {Promise<object>} Verified claims.
   */
  async #verifyJwt(token) {
    const parts = token.split(".");
    if (parts.length !== 3) throw new LicenseError("Malformed token", "INVALID_TOKEN");
    const [header, body, signature] = parts;

    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      await this.#importRsaKey(),
      LicenseClient.#decodeBase64Url(signature),
      new TextEncoder().encode(`${header}.${body}`)
    );
    if (!valid) throw new LicenseError("Token signature invalid", "INVALID_TOKEN");

    const claims = JSON.parse(new TextDecoder().decode(LicenseClient.#decodeBase64Url(body)));
    if (claims.exp && claims.exp < Math.floor(Date.now() / 1000)) {
      throw new LicenseError("Token expired", "TOKEN_EXPIRED");
    }
    return claims;
  }

  /**
   * @param {object} payload
   * @param {string} jwt
   */
  async #verifyResponse(payload, jwt) {
    const claims = await this.#verifyJwt(jwt);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(payload)));
    const expected = btoa(String.fromCodePoint(...new Uint8Array(digest)))
      .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    if (claims.ph !== expected) throw new LicenseError("Response payload tampered", "SIGNATURE_INVALID");
  }

  /* -- Fingerprint ----------------------------------------------------------- */

  async #computeFingerprint() {
    const parts = [
      game.world?.id ?? "unknown",
      game.version ?? "",
      this.#installationId,
      navigator.language,
      navigator.hardwareConcurrency,
      screen.width, screen.height, screen.colorDepth,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      await LicenseClient.#canvasFingerprint()
    ].join("|");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts));
    return btoa(String.fromCodePoint(...new Uint8Array(digest)));
  }

  /** @returns {Promise<string>} */
  static async #canvasFingerprint() {
    try {
      const element = document.createElement("canvas");
      element.width = 200;
      element.height = 50;
      const ctx = element.getContext("2d");
      ctx.textBaseline = "top";
      ctx.font = "14px Arial";
      ctx.fillStyle = "#f60";
      ctx.fillRect(125, 1, 62, 20);
      ctx.fillStyle = "#069";
      ctx.fillText("vnd-fp", 2, 15);
      ctx.fillStyle = "rgba(102,204,0,0.7)";
      ctx.fillText("vnd-fp", 4, 17);
      return element.toDataURL().slice(-32);
    } catch {
      return "no-canvas";
    }
  }
}
