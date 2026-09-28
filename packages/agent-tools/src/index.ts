import { execFile } from 'node:child_process';
import { BuilderError } from '@builder/shared';
import { decide, validateCommand, type ApprovalPolicy } from '@builder/permissions';
import { ProjectEngine } from '@builder/project-engine';
import { ProcessManager } from '@builder/process-manager';
import * as git from '@builder/git';
import * as github from '@builder/github';
import { getTree, safeRead, searchFiles } from '@builder/filesystem';

export interface ToolContext {
  root: string;
  engine: ProjectEngine;
  procs: ProcessManager;
  policy: ApprovalPolicy;
  approvals: Map<string, boolean>; // tool -> allowed for this run
  emit: (msg: string) => void;
  githubToken?: string;
  confirmHighImpact?: (tool: string, detail: string) => Promise<boolean>;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  validate: (input: Record<string, unknown>) => void;
}

function req(input: Record<string, unknown>, key: string, type: string): void {
  if (typeof input[key] !== type || (type === 'string' && !(input[key] as string).trim())) {
    throw new BuilderError('VALIDATION_ERROR', `Tool input "${key}" must be a non-empty ${type}`);
  }
}

export const TOOL_DEFS: ToolDef[] = [
  { name: 'read_file', description: 'Read a file inside the project', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, validate: (i) => req(i, 'path', 'string') },
  { name: 'write_file', description: 'Create or overwrite a file inside the project', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] }, validate: (i) => { req(i, 'path', 'string'); if (typeof i['content'] !== 'string') throw new BuilderError('VALIDATION_ERROR', 'content must be a string'); } },
  { name: 'apply_patch', description: 'Replace a search string with new content in a file', parameters: { type: 'object', properties: { path: { type: 'string' }, search: { type: 'string' }, replace: { type: 'string' } }, required: ['path', 'search', 'replace'] }, validate: (i) => { req(i, 'path', 'string'); req(i, 'search', 'string'); if (typeof i['replace'] !== 'string') throw new BuilderError('VALIDATION_ERROR', 'replace must be a string'); } },
  { name: 'delete_file', description: 'Delete a file or directory inside the project', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, validate: (i) => req(i, 'path', 'string') },
  { name: 'list_directory', description: 'List a directory inside the project', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: [] }, validate: () => {} },
  { name: 'get_project_tree', description: 'Get the project file tree', parameters: { type: 'object', properties: {} }, validate: () => {} },
  { name: 'search_files', description: 'Search file names and contents', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }, validate: (i) => req(i, 'query', 'string') },
  { name: 'inspect_project', description: 'Inspect framework, package manager, scripts, git', parameters: { type: 'object', properties: {} }, validate: () => {} },
  { name: 'run_command', description: 'Run a validated command inside the project root', parameters: { type: 'object', properties: { command: { type: 'string' }, args: { type: 'array' } }, required: ['command'] }, validate: (i) => req(i, 'command', 'string') },
  { name: 'run_build', description: 'Run the project build script', parameters: { type: 'object', properties: {} }, validate: () => {} },
  { name: 'run_tests', description: 'Run the project test script', parameters: { type: 'object', properties: {} }, validate: () => {} },
  { name: 'run_lint', description: 'Run the project lint script', parameters: { type: 'object', properties: {} }, validate: () => {} },
  { name: 'start_dev_server', description: 'Start the project dev server', parameters: { type: 'object', properties: {} }, validate: () => {} },
  { name: 'stop_dev_server', description: 'Stop a dev server process', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, validate: (i) => req(i, 'id', 'string') },
  { name: 'restart_dev_server', description: 'Restart a dev server process', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, validate: (i) => req(i, 'id', 'string') },
  { name: 'get_process_output', description: 'Get process output', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, validate: (i) => req(i, 'id', 'string') },
  { name: 'get_process_status', description: 'Get process status', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: [] }, validate: () => {} },
  { name: 'git_status', description: 'Git status', parameters: { type: 'object', properties: {} }, validate: () => {} },
  { name: 'git_diff', description: 'Git diff', parameters: { type: 'object', properties: {} }, validate: () => {} },
  { name: 'git_log', description: 'Git log', parameters: { type: 'object', properties: {} }, validate: () => {} },
  { name: 'git_branch', description: 'Current branch', parameters: { type: 'object', properties: {} }, validate: () => {} },
  { name: 'git_commit', description: 'Stage all and commit', parameters: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] }, validate: (i) => req(i, 'message', 'string') },
  { name: 'git_push', description: 'Push to remote', parameters: { type: 'object', properties: {} }, validate: () => {} },
  { name: 'git_pull', description: 'Pull from remote', parameters: { type: 'object', properties: {} }, validate: () => {} },
  { name: 'get_preview_url', description: 'Get the running preview URL', parameters: { type: 'object', properties: {} }, validate: () => {} },
  { name: 'get_runtime_errors', description: 'Get recent dev-server errors from process output', parameters: { type: 'object', properties: {} }, validate: () => {} },
  { name: 'github_list_repositories', description: 'List GitHub repositories', parameters: { type: 'object', properties: {} }, validate: () => {} },
  { name: 'github_create_repository', description: 'Create a GitHub repository', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, validate: (i) => req(i, 'name', 'string') },
  { name: 'github_export', description: 'Push project to a GitHub remote', parameters: { type: 'object', properties: { remoteUrl: { type: 'string' } }, required: ['remoteUrl'] }, validate: (i) => req(i, 'remoteUrl', 'string') },
  { name: 'finish_task', description: 'Mark the task complete with a summary', parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] }, validate: (i) => req(i, 'summary', 'string') },
];

function runCmd(cwd: string, command: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    // Quote exe paths containing spaces on Windows; never combine shell:true with an args array.
    const needsShell = process.platform === 'win32' && /[^a-zA-Z0-9_\\/:.-]/.test(command);
    const opts = needsShell
      ? { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, shell: true as const }
      : { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, shell: false as const };
    const cmd = needsShell ? `"${command}"` : command;
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? (err as Error | null)?.message ?? ''), code: (err as { code?: number } | null)?.code ?? 0 });
    });
  });
}

export async function executeTool(tool: string, input: Record<string, unknown>, ctx: ToolContext): Promise<{ ok: boolean; result: unknown }> {
  const def = TOOL_DEFS.find((d) => d.name === tool);
  if (!def) throw new BuilderError('TOOL_ERROR', `Unknown tool: ${tool}`);
  def.validate(input);

  const dangerous = tool === 'run_command'
    ? (await import('@builder/permissions')).isDangerousCommand([String(input['command'] ?? ''), ...((input['args'] as string[]) ?? [])].join(' '))
    : false;
  const decision = decide(tool, ctx.policy, { dangerous });
  if (decision.requiresApproval && !ctx.approvals.get(tool)) {
    if (ctx.confirmHighImpact) {
      const ok = await ctx.confirmHighImpact(tool, JSON.stringify(input).slice(0, 300));
      if (!ok) throw new BuilderError('PERMISSION_DENIED', `User denied ${tool}`);
      ctx.approvals.set(tool, true);
    } else {
      throw new BuilderError('PERMISSION_DENIED', `Approval required for ${tool}: ${decision.reason}`);
    }
  }

  const { engine, procs, root } = ctx;
  switch (tool) {
    case 'read_file': return { ok: true, result: await engine.readFile(String(input['path'])) };
    case 'write_file': await engine.writeFile(String(input['path']), String(input['content'] ?? '')); return { ok: true, result: 'written' };
    case 'apply_patch': await engine.patchFile(String(input['path']), { search: String(input['search']), replace: String(input['replace']) }); return { ok: true, result: 'patched' };
    case 'delete_file': await engine.deleteFile(String(input['path'])); return { ok: true, result: 'deleted' };
    case 'list_directory': return { ok: true, result: await getTree(root, String(input['path'] ?? '.'), 1) };
    case 'get_project_tree': return { ok: true, result: await engine.getTree() };
    case 'search_files': return { ok: true, result: await searchFiles(root, String(input['query'])) };
    case 'inspect_project': return { ok: true, result: await engine.inspectProject() };
    case 'run_command': {
      const command = String(input['command']);
      const args = (input['args'] as string[]) ?? [];
      const v = validateCommand(command, args, root, root);
      if (!v.ok) throw new BuilderError('PERMISSION_DENIED', v.reason ?? 'blocked');
      const r = await runCmd(root, command, args, 120_000);
      return { ok: r.code === 0, result: { code: r.code, stdout: r.stdout.slice(-8000), stderr: r.stderr.slice(-8000) } };
    }
    case 'run_build': case 'run_tests': case 'run_lint': {
      const script = tool === 'run_build' ? 'build' : tool === 'run_tests' ? 'test' : 'lint';
      const insp = await engine.inspectProject();
      const pm = insp.packageManager;
      const bin = pm === 'npm' ? 'npm' : pm;
      const args = pm === 'npm' ? ['run', script] : ['run', script];
      const r = await runCmd(root, bin, args, 180_000);
      return { ok: r.code === 0, result: { code: r.code, stdout: r.stdout.slice(-8000), stderr: r.stderr.slice(-8000) } };
    }
    case 'start_dev_server': {
      const insp = await engine.inspectProject();
      const pm = insp.packageManager;
      const bin = pm === 'npm' ? 'npm' : pm;
      const args = pm === 'npm' ? ['run', 'dev', '--', '--host', '127.0.0.1'] : ['run', 'dev'];
      const p = procs.start(bin, args, root, { detectUrl: true });
      return { ok: true, result: p };
    }
    case 'stop_dev_server': return { ok: true, result: procs.stop(String(input['id'])) };
    case 'restart_dev_server': return { ok: true, result: procs.restart(String(input['id'])) };
    case 'get_process_output': return { ok: true, result: procs.output(String(input['id'])) };
    case 'get_process_status': return { ok: true, result: procs.list() };
    case 'git_status': return { ok: true, result: await git.status(root) };
    case 'git_diff': return { ok: true, result: await git.diff(root) };
    case 'git_log': return { ok: true, result: await git.log(root) };
    case 'git_branch': return { ok: true, result: await git.branch(root) };
    case 'git_commit': return { ok: true, result: await git.commit(root, String(input['message'])) };
    case 'git_push': return { ok: true, result: await git.push(root) };
    case 'git_pull': return { ok: true, result: await git.pull(root) };
    case 'get_preview_url': {
      const list = procs.list();
      const withUrl = list.find((p) => p.previewUrl);
      return { ok: true, result: withUrl?.previewUrl ?? null };
    }
    case 'get_runtime_errors': {
      const list = procs.list();
      const errs = list.flatMap((p) => p.output.split('\n').filter((l) => /error|failed|exception|ENOENT|EADDRINUSE/i.test(l)).slice(-20).map((line) => ({ process: p.id, line: line.slice(0, 300) })));
      return { ok: true, result: errs.slice(-30) };
    }
    case 'github_list_repositories': return { ok: true, result: await github.listRepositories({ token: ctx.githubToken }) };
    case 'github_create_repository': return { ok: true, result: await github.createRepository(String(input['name']), { cwd: root, token: ctx.githubToken }) };
    case 'github_export': return { ok: true, result: await github.exportPush(root, String(input['remoteUrl'])) };
    case 'finish_task': return { ok: true, result: { finished: true, summary: String(input['summary']) } };
    default: throw new BuilderError('TOOL_ERROR', `Unhandled tool: ${tool}`);
  }
}

export { safeRead };
