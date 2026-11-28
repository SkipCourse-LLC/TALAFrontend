/**
 * Subject areas drive the My Map colors: a course, and every standard in it, takes the
 * color of its subject. Courses have no subject field in the graph, so it is read from the
 * course name. Rules run top to bottom and the first match wins, so put the specific ones
 * ("Veterinary Science") before the general ones ("Science").
 */

export const GENERAL_SUBJECT = 'General';

export const SUBJECTS = [
  'Mathematics',
  'Science',
  'Language & Literature',
  'Social Studies',
  'Arts & Media',
  'Technology & Computing',
  'Engineering & Trades',
  'Business & Hospitality',
  'Health & Fitness',
  'Agriculture & Natural Resources',
  GENERAL_SUBJECT,
] as const;

export type Subject = (typeof SUBJECTS)[number];

const RULES: Array<[Subject, RegExp]> = [
  // School-wide support courses that belong to no subject.
  [GENERAL_SUBJECT, /^(education|family|library|instructional|support services|thinking skills|approaches to learning|advancement via individual determination|guidance aide|leadership|self-management|employability skills)$/],
  ['Agriculture & Natural Resources', /agri|animal|aquacultur|botany|equine|forestry|horticultur|natural resources|plant processing|soil|turf|veterinary|viticultur|wildland|eco-tourism/],
  ['Health & Fitness', /health|medical|nursing|dental|pharmac|phlebotom|\bekg\b|nutrition|fitness|physical education|gymnastic|tennis|aquatics|recreation sports|sports medicine|weight training|self-defense|caregiving|gerontology|elder care|therap|optometr|vision care|diagnostic|massage|first aid|emergency medical|counseling|\bmental\b|biomedical|laboratory assisting|cosmetolog|barbering|aesthetics|child care|early childhood/],
  ['Mathematics', /algebra|geometry|calculus|trigonometry|statistics|probability|precalculus|elementary functions|discrete|number theory|^math|applied math/],
  ['Technology & Computing', /comput|programming|software|network|cisco|netware|database|web page|cyber|java|c\+\+|mobile app|data systems|telecommunication|keyboarding|word processing|information support|it essentials|microsoft certified|modeling simulation|wireless|desktop publishing|emerging technologies|electronic technologies|^technology$|technological inquiry|geospatial|virtual design|drone|suas|cad design/],
  ['Social Studies', /crime|criminal|corrections|justice|rotc|military|army|navy|naval|fire management|security protection|political|legal|\blaw\b|global perspectives|public administration|government service|school governance|(?<!consumer )economics/],
  ['Business & Hospitality', /account|administration|advertis|banking|finance|business|marketing|management|sales|retail|cashier|culinary|baking|restaurant|lodging|hospitality|travel|tourism|insurance|investing|income tax|recordkeeping|office|distribution|logistics|warehouse|international business|consumer economics|product development/],
  ['Engineering & Trades', /engineer|drafting|welding|machin|carpent|electri|hvac|air conditioning|heating|refrigeration|automotive|diesel|construction|plumbing|aviation|aircraft|pilot|aerospace|manufactur|masonry|cabinet|wood|metal|robotics|automation|mechanic|repair|appliance|blueprint|boat|concrete|solar|energy|laser|analog|hybrid engines|motorsports|small engine|heavy equipment|truck|bus driving|power mechanics|building maintenance|institutional maintenance|wall finish|water treatment|production systems|processing|material processes|operation|equipment|print press|printing|publication production|jewelry|ceramic processing|home furnishings|apparel|clothing|textile|fashion|sewing|industrial arts/],
  ['Language & Literature', /^english|^ela$|literature|composition|(?<!play)writing|reading|speech|language|afrikaans|arabic|chinese|french|german|greek|hebrew|italian|japanese|korean|latin|portuguese|russian|spanish|swahili|urdu|vietnamese|filipino|iranian|persian|celtic|indic|turkic|humanities/],
  ['Arts & Media', /\barts?\b|music|band|orchestra|chorus|vocal|guitar|piano|strings|instrumental|\bdance\b|choreograph|theater|theatre|drama|directing|playwriting|stagecraft|film|video|animation|photo|ceramic|pottery|calligraphy|printmaking|crafts|design|media|recording|radio|broadcast|moving image|expressive movement|corps movement|visual|studio|audio|multimedia|journalism|imaging/],
  ['Science', /science|biolog|chemistry|physics|astronomy|geology|meteorology|genetics|zoology|microbiology|bioscience|environmental|origins of|marine|sustainability|research|\bstem\b|forensic|organic|anatomy|physiology/],
  ['Social Studies', /history|civics|geograph|government|sociology|psychology|anthropology|philosophy|religio|theolog|ministry|divinity|christology|liturgy|prayer|spirituality|testament|bible|biblical|scriptures|civilization|world area|theory of knowledge|western|ethics|social studies/],
];

/** Subject area for a course name. Anything unrecognized is "General". */
export function subjectForCourse(courseName: string | undefined | null): Subject {
  const name = (courseName ?? '').trim().toLowerCase();
  if (!name) return GENERAL_SUBJECT;
  for (const [subject, pattern] of RULES) if (pattern.test(name)) return subject;
  return GENERAL_SUBJECT;
}
