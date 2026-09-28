import path from 'node:path';

export type PermissionLevel = 'SAFE' | 'MODERATE' | 'HIGH' | 'CRITICAL';
export type ApprovalPolicy = 'strict' | 'moderate' | 'permissive';

const TOOL_LEVELS: Record<string, PermissionLevel> = {
  read_file: 'SAFE', list_directory: 'SAFE', search_files: 'SAFE', inspect_project: 'SAFE',
  get_project_tree: 'SAFE', git_status: 'SAFE', git_diff: 'SAFE', git_log: 'SAFE', git_branch: 'SAFE',
  get_preview_url: 'SAFE', get_process_status: 'SAFE', get_process_output: 'SAFE', get_runtime_errors: 'SAFE',
  write_file: 'MODERATE', apply_patch: 'MODERATE', delete_file: 'MODERATE', run_build: 'MODERATE',
  run_tests: 'MODERATE', run_lint: 'MODERATE', start_dev_server: 'MODERATE', restart_dev_server: 'MODERATE',
  stop_dev_server: 'MODERATE', run_command: 'MODERATE',
  github_list_repositories: 'HIGH', github_create_repository: 'HIGH', github_export: 'HIGH',
  git_push: 'HIGH', git_pull: 'HIGH', install_dependency: 'HIGH',
  force_push: 'CRITICAL', delete_repository: 'CRITICAL', exec_outside_root: 'CRITICAL',
};

export function toolLevel(tool: string): PermissionLevel {
  return TOOL_LEVELS[tool] ?? 'HIGH';
}

export interface ApprovalDecision { allowed: boolean; requiresApproval: boolean; reason: string }

const DANGEROUS = [/\brm\s+-rf\b/, /\brmdir\s+\/s\b/i, /\bformat\b\s+[a-z]:/i, /:\(\)\s*{\s*:\|:\s*&\s*}\s*;/, /\bdel\s+\/[fq]\b/i, /__proto__|constructor\s*\[.*\]/];

export function isDangerousCommand(cmd: string): boolean {
  return DANGEROUS.some((r) => r.test(cmd));
}

export function decide(tool: string, policy: ApprovalPolicy, opts: { dangerous?: boolean; outsideRoot?: boolean } = {}): ApprovalDecision {
  const level = toolLevel(tool);
  if (opts.outsideRoot) return { allowed: false, requiresApproval: true, reason: 'Operation outside project root is blocked' };
  if (opts.dangerous) return { allowed: false, requiresApproval: true, reason: 'Dangerous operation requires explicit approval' };
  if (level === 'CRITICAL') return { allowed: false, requiresApproval: true, reason: `${tool} is critical and requires explicit approval` };
  if (level === 'HIGH') {
    if (policy === 'permissive') return { allowed: true, requiresApproval: false, reason: 'Permissive policy auto-allows HIGH' };
    return { allowed: false, requiresApproval: true, reason: `${tool} requires approval under ${policy} policy` };
  }
  if (level === 'MODERATE') {
    if (policy === 'strict') return { allowed: false, requiresApproval: true, reason: `${tool} requires approval under strict policy` };
    return { allowed: true, requiresApproval: false, reason: `${tool} auto-allowed under ${policy}` };
  }
  return { allowed: true, requiresApproval: false, reason: 'SAFE tool' };
}

export function validateCommand(command: string, args: string[], cwd: string, root: string): { ok: boolean; reason?: string } {
  const full = [command, ...args].join(' ');
  if (isDangerousCommand(full)) return { ok: false, reason: `Blocked dangerous command: ${full.slice(0, 120)}` };
  const cwdAbs = path.resolve(cwd);
  const rootAbs = path.resolve(root);
  const rel = path.relative(rootAbs, cwdAbs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return { ok: false, reason: 'Working directory outside project root' };
  return { ok: true };
}
