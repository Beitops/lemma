import { useEffect, useRef, useState } from "react";
import {
  registerWebMcpTools,
  type WebMcpRuntime,
} from "../lib/webmcp";

export type UseWebMcpOptions = WebMcpRuntime;

/**
 * Keeps one document-scoped WebMCP registration alive for the application's
 * lifetime. Runtime dependencies stay current through a ref, so workspace UI
 * changes do not replace registered tools.
 */
export function useWebMcp(options: UseWebMcpOptions): boolean {
  const runtimeRef = useRef<WebMcpRuntime>(options);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    runtimeRef.current = options;
  }, [options]);

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;

    void registerWebMcpTools({
      controller,
      getRuntime: () => runtimeRef.current,
    }).then((registered) => {
      if (mounted && !controller.signal.aborted) setAvailable(registered);
    });

    return () => {
      mounted = false;
      controller.abort();
    };
  }, []);

  return available;
}
