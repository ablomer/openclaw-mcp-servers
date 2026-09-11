export const DEFAULT_MCP_TIMEOUT_MS = 10_000;

function timeoutError(toolName, timeoutMs) {
  return Object.assign(new Error(`MCP ${toolName} timed out after ${timeoutMs}ms`), {
    name: 'TimeoutError',
  });
}

function watchdog(timeoutMs, err) {
  let timer;
  const promise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(err), timeoutMs);
  });
  return {
    promise,
    clear() {
      clearTimeout(timer);
    },
  };
}

/**
 * Executes a tool call against an MCP Streamable HTTP server.
 * `fetchImpl` is the 4th argument so tests can stub fetch.
 */
export async function callMcpTool(
  url,
  toolName,
  args,
  fetchImpl = globalThis.fetch,
  { timeoutMs = DEFAULT_MCP_TIMEOUT_MS } = {},
) {
  const payload = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: args,
    },
  };

  const run = async (signal) => {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(payload),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`HTTP ${response.status} - ${errText}`);
    }

    const rawText = await response.text();
    let data;

    try {
      data = JSON.parse(rawText);
    } catch {
      const dataLine = rawText.split('\n').find((line) => line.startsWith('data: {'));
      if (dataLine) {
        try {
          data = JSON.parse(dataLine.slice(6));
        } catch {
          return { error: `Failed to parse SSE data. Raw: ${dataLine.substring(0, 100)}` };
        }
      } else {
        return { error: `No valid JSON found. Raw: ${rawText.substring(0, 100)}` };
      }
    }

    if (data.error) return { error: data.error.message || JSON.stringify(data.error) };

    const resultObj = data.result;
    if (!resultObj) return { error: 'No result object in response' };

    const content = resultObj.content?.[0];
    if (!content || content.type !== 'text') {
      return { error: 'No text content in response' };
    }

    if (resultObj.isError) {
      return { error: `Tool returned error: ${content.text}` };
    }

    if (typeof content.text === 'object') {
      return content.text;
    }

    try {
      return JSON.parse(content.text);
    } catch (err) {
      const snippet = content.text.substring(0, 200).replace(/\n/g, ' ');
      return { error: `JSON parse failed (${err.message}). Server returned: ${snippet}` };
    }
  };

  try {
    if (!timeoutMs || timeoutMs <= 0) {
      return await run();
    }

    const controller = new AbortController();
    const timer = watchdog(timeoutMs, timeoutError(toolName, timeoutMs));
    try {
      return await Promise.race([run(controller.signal), timer.promise]);
    } catch (err) {
      controller.abort();
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        return { error: `MCP ${toolName} timed out after ${timeoutMs}ms` };
      }
      return { error: err.message };
    } finally {
      timer.clear();
    }
  } catch (err) {
    return { error: err.message };
  }
}
