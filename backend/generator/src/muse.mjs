// Muse: an OpenAI-compatible chat API (default https://api.meta.ai/v1). A port of the parts of
// MuseClient.swift the microgame path uses: Bearer auth, JSON mode, a token budget that doubles
// once when a reply is cut off, and retries with backoff on 429, 5xx and dropped connections.
// The key comes from the environment of this container only. It is never logged or returned.

export class MuseError extends Error {
  constructor(message, { status = 0, retryable = false } = {}) {
    super(message);
    this.name = 'MuseError';
    this.status = status;
    this.retryable = retryable;
  }
}

/** The JSON object in a model reply, tolerating code fences and stray prose around it. */
export function extractObject(text) {
  const t = String(text ?? '').trim();
  const tryParse = (s) => {
    try {
      const v = JSON.parse(s);
      return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  };
  let v = tryParse(t);
  if (v) return v;
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && (v = tryParse(fenced[1].trim()))) return v;
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return tryParse(t.slice(a, b + 1));
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class MuseClient {
  constructor({ apiKey = '', baseURL = 'https://api.meta.ai/v1', fetchImpl = globalThis.fetch } = {}) {
    this.apiKey = String(apiKey).trim();
    this.baseURL = String(baseURL).replace(/\/+$/, '');
    this.fetch = fetchImpl;
  }

  get isConfigured() {
    return this.apiKey.length > 0;
  }

  async #send(path, body, { timeout, maxAttempts }) {
    let attempt = 0;
    for (;;) {
      attempt++;
      let error;
      try {
        const res = await this.fetch(`${this.baseURL}/${path}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeout * 1000),
        });
        const text = await res.text();
        if (res.ok) return JSON.parse(text);
        let message = text.slice(0, 200);
        try {
          const j = JSON.parse(text);
          message = j?.error?.message ?? j?.message ?? message;
        } catch {}
        error = new MuseError(`Muse answered ${res.status}: ${message}`, { status: res.status, retryable: res.status === 429 || res.status >= 500 });
        error.retryAfter = Number(res.headers.get('retry-after')) || 0;
      } catch (e) {
        if (e instanceof MuseError) error = e;
        else if (e?.name === 'TimeoutError') error = new MuseError(`Muse didn't answer within ${timeout} s`, { retryable: true });
        else error = new MuseError(`Couldn't reach Muse: ${e?.message ?? e}`, { retryable: true });
      }
      if (!error.retryable || attempt >= maxAttempts) throw error;
      await sleep(Math.min(20000, (error.retryAfter || 2 * attempt) * 1000));
    }
  }

  /**
   * One image from muse-image-1.0 (the responses API's image_generation tool). guide: an optional PNG the model
   * sees with the prompt (the game's real layout). Returns {png: Buffer, model, seconds}.
   */
  async image({ prompt, size = '1024x1024', guide = null, model = 'muse-image-1.0', timeout = 150, maxAttempts = 2 }) {
    if (!this.isConfigured) throw new MuseError('Muse is not configured on this server.');
    const content = [{ type: 'input_text', text: prompt }];
    if (guide) content.push({ type: 'input_image', image_url: 'data:image/png;base64,' + Buffer.from(guide).toString('base64') });
    const started = Date.now();
    const data = await this.#send('responses', {
      model, store: false, input: [{ role: 'user', content }],
      tools: [{ type: 'image_generation', enable_image_search: false, enable_web_search: false, enable_shell: false, reasoning_strength: 'low', size, output_format: 'png' }],
    }, { timeout, maxAttempts });
    const call = (data?.output ?? []).find((x) => x?.type === 'image_generation_call' && x.result);
    if (!call) throw new MuseError(`${model} returned no image (${data?.status ?? 'no status'}${data?.incomplete_details ? ': ' + JSON.stringify(data.incomplete_details) : ''}).`);
    return { png: Buffer.from(call.result, 'base64'), model: data.model ?? model, seconds: (Date.now() - started) / 1000 };
  }

  /** One system + user turn in JSON mode. Returns the reply text and the model that answered.
   *  Asks again once if the reply holds no JSON object. */
  async chatJSON({ model, system, user, maxTokens = 16000, reasoningEffort = 'medium', timeout = 150, maxAttempts = 2 }) {
    const usage = { prompt_tokens: 0, completion_tokens: 0, reasoning_tokens: 0, total_tokens: 0, calls: 0 };
    const tally = (u) => {
      usage.calls++;
      usage.prompt_tokens += Number(u?.prompt_tokens) || 0;
      usage.completion_tokens += Number(u?.completion_tokens) || 0;
      usage.reasoning_tokens += Number(u?.completion_tokens_details?.reasoning_tokens ?? u?.reasoning_tokens) || 0;
      usage.total_tokens += Number(u?.total_tokens) || (Number(u?.prompt_tokens) || 0) + (Number(u?.completion_tokens) || 0);
    };
    if (!this.isConfigured) throw new MuseError('Muse is not configured on this server.');
    let budget = Math.max(maxTokens, 4000); // the text models reason first; small budgets come back empty
    let last;
    for (let ask = 0; ask < 2; ask++) {
      let content = '';
      let answered = model;
      for (let pass = 0; pass < 2; pass++) {
        const body = {
          model,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          response_format: { type: 'json_object' },
          max_tokens: budget,
        };
        if (reasoningEffort) body.reasoning_effort = reasoningEffort;
        const data = await this.#send('chat/completions', body, { timeout, maxAttempts });
        tally(data?.usage);
        const choice = data?.choices?.[0];
        if (!choice) throw new MuseError('Muse sent no choices.');
        content = String(choice.message?.content ?? '').trim();
        answered = data.model ?? model;
        if (content) break;
        if (choice.finish_reason === 'length' && pass === 0) {
          budget = Math.min(budget * 2, 32000);
          continue;
        }
        throw new MuseError(`${answered} sent an empty reply (${choice.finish_reason ?? 'no reason given'}).`);
      }
      last = { content, model: answered, usage: { ...usage } };
      if (extractObject(content)) return last;
    }
    throw new MuseError(`${last?.model ?? model} didn't return a JSON object.`);
  }
}

/** A stand-in Muse that replies from a script, for tests: each call returns the next reply (the
 *  last one repeats). Replies are objects (sent as JSON text) or strings. */
export class ScriptedMuse {
  constructor(replies, model = 'scripted-muse') {
    this.replies = replies;
    this.model = model;
    this.prompts = [];
    this.isConfigured = true;
  }

  async chatJSON({ user }) {
    this.prompts.push(user);
    const r = this.replies[Math.min(this.prompts.length - 1, this.replies.length - 1)];
    return { content: typeof r === 'string' ? r : JSON.stringify(r), model: this.model, usage: { prompt_tokens: 0, completion_tokens: 0, reasoning_tokens: 0, total_tokens: 0, calls: 1 } };
  }
}
