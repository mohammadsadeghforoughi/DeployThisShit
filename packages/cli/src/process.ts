import { spawn } from "node:child_process";

export async function run(
  command: string,
  args: string[],
  options: { cwd?: string; capture?: boolean; env?: NodeJS.ProcessEnv } = {}
): Promise<string> {
  return await new Promise((resolve, reject) => {
    const capture = options.capture ?? false;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit"
    });
    let stdout = "";
    let stderr = "";
    if (capture) {
      child.stdout!.setEncoding("utf8");
      child.stderr!.setEncoding("utf8");
      child.stdout!.on("data", (chunk: string) => (stdout += chunk));
      child.stderr!.on("data", (chunk: string) => (stderr += chunk));
    }
    child.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error(`${command} is not installed or is not available on PATH.`));
      } else reject(error);
    });
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(capture && stderr.trim() ? stderr.trim() : `${command} exited with code ${code}.`));
    });
  });
}

