/**
 * The app's icon vocabulary, in ONE place.
 *
 * Why this module exists: Astryx's built-in semantic icon registry only carries
 * ~28 affordance names (chevrons, arrows, close, search…) and has no concept
 * icons — no "agents", no "memory", no "governance". Left to pick from that set
 * per call site, the UI reached for the same shape twice and two controls became
 * indistinguishable (`wrench` on both "Skill library" and "memory & knowledge").
 *
 * Astryx's own Icon component documents the supported answer: "Component mode:
 * pass an SVG icon component (e.g. from @heroicons/react)". So every semantic
 * icon below is a Heroicon wrapped in Astryx's `Icon`, keeping sizing, colour
 * tokens and theming inside the framework.
 *
 * Rule: a concept gets exactly one icon here, and call sites import it. If two
 * controls need to read differently, they get two entries — never the same glyph.
 */
import {Icon, type IconProps} from '@astryxdesign/core/Icon';
import {
  ArrowPathIcon,
  ArrowUpTrayIcon,
  ChatBubbleLeftRightIcon,
  CheckCircleIcon,
  CheckIcon,
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
  CircleStackIcon,
  ClipboardDocumentCheckIcon,
  ClockIcon,
  CommandLineIcon,
  CurrencyDollarIcon,
  DocumentIcon,
  ExclamationTriangleIcon,
  EyeSlashIcon,
  InformationCircleIcon,
  MagnifyingGlassIcon,
  PaperClipIcon,
  PlusIcon,
  PlusCircleIcon,
  PowerIcon,
  ScaleIcon,
  ServerStackIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UserGroupIcon,
  UsersIcon,
  WrenchScrewdriverIcon,
  XCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

type IconPropsLite = Pick<IconProps, 'size' | 'color' | 'label'>;

const wrap = (Glyph: React.ComponentType<React.SVGProps<SVGSVGElement>>) =>
  function Themed({size, color, label}: IconPropsLite) {
    return <Icon icon={Glyph} size={size} color={color} label={label} />;
  };

// ── Navigation ───────────────────────────────────────────────────────────────
/** Chat with the fleet. */
export const IconMessages = wrap(ChatBubbleLeftRightIcon);
/** The agent hierarchy. */
export const IconAgents = wrap(UsersIcon);
/** The holographic memory store. */
export const IconMemory = wrap(CircleStackIcon);
/** Jev / TypeSafe typed decisions. */
export const IconDecisions = wrap(ScaleIcon);
/** The OKF governance ledger. */
export const IconGovernance = wrap(ShieldCheckIcon);
/** Supervised services and health. */
export const IconOps = wrap(ServerStackIcon);
/** Token spend and usage. */
export const IconCost = wrap(CurrencyDollarIcon);
/** Past sessions. */
export const IconConversations = wrap(ClockIcon);
/** Multi-agent group chat. */
export const IconGroupChat = wrap(UserGroupIcon);
/** Propose / create a bot (consent flow). */
export const IconCreateBot = wrap(PlusCircleIcon);

// ── Top-bar actions ──────────────────────────────────────────────────────────
/** The skill library — a separate concept from a bot's own memory. */
export const IconSkills = wrap(WrenchScrewdriverIcon);
/** The agent computer (live screen), NOT search. */
export const IconAgentComputer = wrap(CommandLineIcon);
/** A bot's own memory & knowledge panel. */
export const IconBotKnowledge = wrap(SparklesIcon);

// ── Shared affordances ───────────────────────────────────────────────────────
export const IconWarning = wrap(ExclamationTriangleIcon);
export const IconInfo = wrap(InformationCircleIcon);
export const IconSearch = wrap(MagnifyingGlassIcon);
export const IconRefresh = wrap(ArrowPathIcon);
export const IconUpload = wrap(ArrowUpTrayIcon);
export const IconApply = wrap(ClipboardDocumentCheckIcon);
export const IconAdd = wrap(PlusIcon);
export const IconPower = wrap(PowerIcon);
/** Attach a file. */
export const IconAttach = wrap(PaperClipIcon);
/** A file/attachment chip. */
export const IconFile = wrap(DocumentIcon);
export const IconClose = wrap(XMarkIcon);
export const IconCheck = wrap(CheckIcon);
export const IconSuccess = wrap(CheckCircleIcon);
export const IconError = wrap(XCircleIcon);
/** A secret that must not be shown. */
export const IconConceal = wrap(EyeSlashIcon);
/** Collapse a side panel. */
export const IconCollapsePanel = wrap(ChevronDoubleLeftIcon);
/** Re-open a collapsed side panel. */
export const IconExpandPanel = wrap(ChevronDoubleRightIcon);

/**
 * A secret request: concealment when it is an ACCESS request, the warning
 * triangle otherwise. One helper so the two states stay visually distinct
 * without the call site carrying the ternary.
 */
export function IconConcealOrWarning({isAccess, ...rest}: IconPropsLite & {isAccess: boolean}) {
  const Glyph = isAccess ? EyeSlashIcon : ExclamationTriangleIcon;
  return <Icon icon={Glyph} {...rest} />;
}
