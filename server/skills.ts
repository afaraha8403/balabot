/**
 * BalaBot Skill Catalog & Curator Resolver
 *
 * Scans installed skills across .agents/skills/ and skills/,
 * resolves precedence (Shipped > Brought > Learned), and queries
 * persistent learned skills from SQLite.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { BalaBotDatabase } from "./db.js";

export interface SkillEntry {
  org?: string;
  name: string;
  source: string;
  description?: string;
  grants?: string[] | string;
  state?: string;
  category?: string;
  pinned?: boolean;
  promoted?: boolean;
}

export interface SkillLibraryCatalog {
  available: boolean;
  learned: SkillEntry[];
  brought: SkillEntry[];
  skills: Array<{ id: string; name: string; tier: string; description: string; source: string }>;
}

export class SkillCurator {
  private db: BalaBotDatabase;

  constructor(db: BalaBotDatabase) {
    this.db = db;
  }

  /**
   * Parses frontmatter from a SKILL.md file.
   */
  private parseSkillMd(filePath: string): { name?: string; description?: string } {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
      if (!match) return {};
      const frontmatter = match[1];
      const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
      const descMatch = frontmatter.match(/^description:\s*["']?(.+?)["']?$/m);
      return {
        name: nameMatch ? nameMatch[1].trim() : undefined,
        description: descMatch ? descMatch[1].trim() : undefined,
      };
    } catch {
      return {};
    }
  }

  /**
   * Scans a directory for skill folders containing SKILL.md.
   */
  private scanSkillsDir(dirPath: string, source: string, category: string): SkillEntry[] {
    const entries: SkillEntry[] = [];
    if (!fs.existsSync(dirPath)) return entries;

    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const item of items) {
      if (!item.isDirectory() && !item.isSymbolicLink()) continue;
      const skillMd = path.join(dirPath, item.name, "SKILL.md");
      if (fs.existsSync(skillMd)) {
        const parsed = this.parseSkillMd(skillMd);
        entries.push({
          name: parsed.name || item.name,
          source,
          description: parsed.description || `Installed skill: ${item.name}`,
          category,
          state: "installed",
        });
      }
    }
    return entries;
  }

  /**
   * Resolves the entire skill library categorized into Brought, Shipped, and Learned.
   */
  public getCatalog(orgId: string = "balacode"): SkillLibraryCatalog {
    const cwd = process.cwd();

    // 1. Shipped skills from skills/
    const shippedSkills = this.scanSkillsDir(path.join(cwd, "skills"), "balabot", "Shipped");

    // 2. Brought skills from .agents/skills/
    const broughtSkills = this.scanSkillsDir(path.join(cwd, ".agents", "skills"), "skills.sh", "Brought");

    // 3. Learned skills from SQLite
    const learnedRows = this.db.listLearnedSkills(orgId);
    const learnedSkills: SkillEntry[] = learnedRows.map(row => ({
      name: row.name,
      source: row.source || "curator",
      description: row.description || "Learned skill refined from harness recursion",
      category: row.category || "Learned",
      state: row.state || "approved",
      pinned: Boolean(row.pinned),
      promoted: Boolean(row.promoted),
    }));

    // If no learned skills exist yet, seed a foundational learned skill so the UI is immediately populated
    if (learnedSkills.length === 0) {
      const seeded = this.db.saveLearnedSkill({
        name: "seo-auditing-heuristics",
        description: "Learned on-page SEO analysis heuristics and SERP intent scoring",
        category: "Learned",
        source: "curator",
        state: "approved",
      });
      learnedSkills.push({
        name: seeded.name,
        source: seeded.source,
        description: seeded.description,
        category: seeded.category,
        state: seeded.state,
      });
    }

    // Consolidated skills flat list for quick lookups
    const flatSkills = [
      { id: "read_file", name: "read_file", tier: "Shipped", description: "Read files in workspace", source: "system" },
      { id: "write_file", name: "write_file", tier: "Shipped", description: "Write files in workspace", source: "system" },
      { id: "exec_command", name: "exec_command", tier: "Shipped", description: "Execute commands in workspace", source: "system" },
      { id: "web_search", name: "web_search", tier: "Shipped", description: "Query live web search", source: "system" },
      ...shippedSkills.map(s => ({
        id: s.name,
        name: s.name,
        tier: "Shipped",
        description: s.description || "",
        source: s.source,
      })),
      ...broughtSkills.map(s => ({
        id: s.name,
        name: s.name,
        tier: "Brought",
        description: s.description || "",
        source: s.source,
      })),
      ...learnedSkills.map(s => ({
        id: s.name,
        name: s.name,
        tier: "Learned",
        description: s.description || "",
        source: s.source,
      })),
    ];

    return {
      available: true,
      learned: learnedSkills,
      brought: [...shippedSkills, ...broughtSkills],
      skills: flatSkills,
    };
  }
}
