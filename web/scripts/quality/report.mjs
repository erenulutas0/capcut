/**
 * Turns what the quality specs measured (.scratch/quality/results/*.json)
 * into docs/quality/latest.md, latest.json and a line of history.jsonl.
 *
 * Every number becomes a "measure" with one of four states:
 *   ok          within its budget (scripts/quality/budgets.json)
 *   over        outside its budget
 *   unmeasured  could not be taken — with the reason
 *   info        has no budget; reported as it is
 * Nothing is ever filled in: a measure with no result file is `unmeasured`.
 *
 * The findings at the top of the report are written by a person (or an
 * agent that looked at the evidence) in docs/quality/findings.md; this
 * script only places them.
 */
import { execSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, release as osRelease, totalmem, type as osType } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// ------------------------------------------------------------------ numbers, Turkish

const nf = (digits) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: digits });
/** 1234.5 → "1.234,5" */
export function num(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return nf(digits).format(value);
}
const pct = (value, digits = 1) => (value === null || value === undefined ? '—' : `%${num(value, digits)}`);
const kb = (bytes) => (bytes === null || bytes === undefined ? '—' : `${num(bytes / 1000, 0)} KB`);
const mb = (bytes, digits = 1) => (bytes === null || bytes === undefined ? '—' : `${num(bytes / 1_000_000, digits)} MB`);
const day = (iso) => (iso ? iso.slice(0, 10) : '—');
const clock = (iso) => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : '—');
const esc = (text) => String(text ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

function table(headers, rows) {
  if (rows.length === 0) return '\n_Satır yok._\n';
  const line = (cells) => `| ${cells.map((cell) => esc(cell)).join(' | ')} |`;
  // The empty line first: a table right under a line of text is not a table in every renderer.
  return `\n${line(headers)}\n${line(headers.map(() => '---'))}\n${rows.map(line).join('\n')}\n`;
}

// ------------------------------------------------------------------ budgets and measures

function loadJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function budgetFor(budgets, id) {
  if (budgets[id]) return budgets[id];
  for (const [pattern, budget] of Object.entries(budgets)) {
    if (!pattern.includes('*')) continue;
    const source = `^${pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^.]+')}$`;
    if (new RegExp(source).test(id)) return budget;
  }
  return null;
}

function judge(value, budget) {
  if (value === null || value === undefined) return 'unmeasured';
  if (!budget) return 'info';
  if ('equals' in budget) return value === budget.equals ? 'ok' : 'over';
  if ('max' in budget && value > budget.max) return 'over';
  if ('min' in budget && value < budget.min) return 'over';
  return 'ok';
}

function budgetText(budget, format = (value) => String(value)) {
  if (!budget) return '';
  if ('equals' in budget) return `= ${budget.equals === true ? 'evet' : budget.equals === false ? 'hayır' : format(budget.equals)}`;
  const parts = [];
  if ('min' in budget) parts.push(`≥ ${format(budget.min)}`);
  if ('max' in budget) parts.push(`≤ ${format(budget.max)}`);
  return parts.join(', ');
}

class Measures {
  constructor(budgets) {
    this.budgets = budgets;
    this.list = [];
  }

  /**
   * `value` null = could not be measured; then `note` must say why.
   * `format` turns the value into what the report prints.
   */
  add(section, id, label, value, { format = (v) => (typeof v === 'boolean' ? (v ? 'evet' : 'hayır') : num(v, 2)), budgetFormat = null, note = '', stale = false } = {}) {
    const budget = budgetFor(this.budgets, id);
    const status = judge(value, budget);
    const measure = {
      section,
      id,
      label,
      value: value ?? null,
      shown: value === null || value === undefined ? 'ölçülemedi' : format(value),
      // `budgetFormat`: for a value that is printed with extra words, the bare number of its budget.
      budget: budget ? budgetText(budget, budgetFormat ?? format) : null,
      status,
      note,
      stale,
    };
    this.list.push(measure);
    return measure;
  }

  /** A table cell: the value, and its budget when it is outside it. */
  cell(section, id, label, value, options) {
    const measure = this.add(section, id, label, value, options);
    if (measure.status === 'over') return `**${measure.shown}** (bütçe ${measure.budget})`;
    if (measure.status === 'unmeasured') return 'ölçülemedi';
    return measure.shown;
  }
}

const STATUS_WORD = { ok: 'bütçe içinde', over: 'BÜTÇE DIŞI', unmeasured: 'ölçülemedi', info: 'bütçesiz' };

// ------------------------------------------------------------------ results

function loadResults(resultsDir) {
  const bySection = new Map();
  if (!existsSync(resultsDir)) return bySection;
  for (const name of readdirSync(resultsDir).filter((file) => file.endsWith('.json')).sort()) {
    const result = loadJson(join(resultsDir, name), null);
    if (!result) continue;
    const list = bySection.get(result.section) ?? [];
    list.push(result);
    bySection.set(result.section, list);
  }
  return bySection;
}

const partsOf = (results, section) => results.get(section) ?? [];
const newest = (parts) => parts.map((part) => part.measuredAt).sort().at(-1) ?? null;
const oldest = (parts) => parts.map((part) => part.measuredAt).sort()[0] ?? null;

function git(webDir, command) {
  try {
    return execSync(`git ${command}`, { cwd: webDir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

// ------------------------------------------------------------------ sections

const TASK_ORDER = ['kes', 'bosluk', 'dikey', 'kucult', 'yazi', 'muzik', 'ses', 'sustur', 'cevir', 'iyilestir'];
const PROJECT_LABEL = { desktop: 'masaüstü (1440 × 900)', phone: 'telefon (390 × 844, dokunmatik)' };

function sectionWalkthrough(results, M) {
  const out = [];
  const head = {};
  const parts = partsOf(results, 'walkthrough');
  const standIn = partsOf(results, 'walkthrough-yazi');
  if (parts.length === 0) {
    M.add('walkthrough', 'walk.run', 'Görev yürüyüşleri', null, { note: 'bu bölümün sonuç dosyası yok (koşulmadı)' });
    return { md: '_Bu bölüm koşulmadı._\n', head };
  }
  out.push(
    'Betikli “ilk kez kullanan”: ana ekrandan başlar, yalnızca görünen ve adıyla bulunabilen düğmelere basar (test kimliği kullanmaz), ' +
      'küçük bir deneme videosuyla işi bitirir, kaydedilen dosya ffprobe / ffmpeg ile denetlenir. Derleme: yayınlanan statik çıktı. ' +
      'Sistem pencereleri (dosya seçme, masaüstünde kaydetme) uygulamanın tıklaması sayılmaz. Süre, hiç duraksamayan bir betiğin süresidir: alt sınırdır.\n',
  );
  for (const project of ['desktop', 'phone']) {
    const tasks = parts.filter((part) => part.part.startsWith(`${project}.`)).flatMap((part) => part.data.tasks);
    if (tasks.length === 0) continue;
    tasks.sort((a, b) => TASK_ORDER.indexOf(a.id) - TASK_ORDER.indexOf(b.id));
    out.push(`\n**${PROJECT_LABEL[project]}**\n`);
    const rows = [];
    let done = 0;
    let counted = 0;
    let maxClicks = 0;
    let jargonTotal = 0;
    for (const original of tasks) {
      // Measure labels say which view they belong to; the table's first column keeps the plain name.
      const task = { ...original, plain: original.label, label: `${original.label} (${project === 'phone' ? 'telefon' : 'masaüstü'})` };
      const id = `walk.${project}.${task.id}`;
      const model = task.id === 'yazi';
      if (task.cutShort) {
        counted += model ? 0 : 1;
        for (const key of ['completed', 'clicks', 'decisions', 'screens', 'wordsMax', 'timeS', 'strongJargon', 'unreachable', 'consoleErrors']) {
          M.add('walkthrough', `${id}.${key}`, `${task.label}: ${key}`, null, { note: task.stopped ?? 'ölçüm betiği yarıda kaldı' });
        }
        rows.push([task.plain, 'ölçülemedi', 'ölçülemedi', '—', 'ölçülemedi', 'ölçülemedi', 'ölçülemedi', '—', 'ölçülemedi', 'ölçülemedi', 'ölçülemedi', 'ölçülemedi']);
        continue;
      }
      if (!model) {
        counted += 1;
        if (task.completed) done += 1;
        maxClicks = Math.max(maxClicks, task.clicks);
      }
      jargonTotal += task.strongJargon.length;
      const completed = model
        ? M.cell('walkthrough', `${id}.completed`, `${task.label}: dosya çıktı ve doğru`, null, { note: task.stopped ?? '' })
        : M.cell('walkthrough', `${id}.completed`, `${task.label}: dosya çıktı ve doğru`, task.completed, { note: task.stopped ?? '' });
      rows.push([
        task.plain,
        completed,
        M.cell('walkthrough', `${id}.clicks`, `${task.label}: tıklama`, task.clicks, { format: (v) => num(v, 0) }),
        num(task.typedFields, 0),
        M.cell('walkthrough', `${id}.decisions`, `${task.label}: karar ekranı`, task.decisions, { format: (v) => num(v, 0) }),
        M.cell('walkthrough', `${id}.screens`, `${task.label}: ekran`, task.screens, { format: (v) => num(v, 0) }),
        M.cell('walkthrough', `${id}.wordsMax`, `${task.label}: en kalabalık ekranda kelime`, task.wordsMax, { format: (v) => num(v, 0) }),
        num(task.wordsTotal, 0),
        M.cell('walkthrough', `${id}.timeS`, `${task.label}: karttan dosyaya süre`, task.timeToResultS, {
          format: (v) => `${num(v, 1)} sn`,
          note: task.timeToResultS === null ? (task.stopped ?? 'dosyaya ulaşılmadı') : '',
        }),
        M.cell('walkthrough', `${id}.strongJargon`, `${task.label}: teknik terim`, task.strongJargon.length, { format: (v) => num(v, 0) }),
        M.cell('walkthrough', `${id}.unreachable`, `${task.label}: adıyla bulunamayan adım`, task.unreachable.length, { format: (v) => num(v, 0) }),
        M.cell('walkthrough', `${id}.consoleErrors`, `${task.label}: konsol / sayfa hatası`, task.problems.pageErrors.length + task.problems.consoleErrors.length, {
          format: (v) => num(v, 0),
        }),
      ]);
    }
    out.push(
      table(
        ['Görev', 'Dosya çıktı ve doğru', 'Tıklama', 'Yazılan alan', 'Karar ekranı', 'Ekran', 'En kalabalık ekran (kelime)', 'Toplam kelime', 'Karttan dosyaya', 'Teknik terim', 'Adıyla bulunamayan', 'Konsol hatası'],
        rows,
      ),
    );
    head[`${project}Done`] = done;
    head[`${project}Counted`] = counted;
    head[`${project}MaxClicks`] = maxClicks;
    head[`${project}Jargon`] = jargonTotal;

    const notes = [];
    for (const task of tasks) {
      if (task.stopped) notes.push(`- **${task.label}:** ${task.stopped}`);
      for (const check of task.checks.filter((item) => !item.ok)) notes.push(`  - denetim tutmadı — ${check.name}: ${check.value}`);
      for (const item of task.unreachable) notes.push(`- **${task.label}:** adıyla bulunamadı: ${item}`);
      for (const error of [...task.problems.pageErrors, ...task.problems.consoleErrors]) notes.push(`- **${task.label}:** konsol: \`${error.slice(0, 200)}\``);
    }
    if (notes.length > 0) out.push(`\nNotlar (${PROJECT_LABEL[project]}):\n\n${notes.join('\n')}\n`);
  }

  // Jargon met on the way, once per distinct sentence.
  const jargon = new Map();
  const mild = new Map();
  for (const task of parts.flatMap((part) => part.data.tasks)) {
    for (const hit of task.strongJargon) {
      const key = `${hit.term}|${hit.context}`;
      const entry = jargon.get(key) ?? { ...hit, tasks: new Set() };
      entry.tasks.add(`${task.label} (${hit.screen})`);
      jargon.set(key, entry);
    }
    for (const hit of task.mildJargon) mild.set(hit.term, (mild.get(hit.term) ?? 0) + 1);
  }
  head.jargonSentences = jargon.size;
  out.push('\n**Varsayılan yolda görülen teknik terimler** (Ayarlar ve Ayrıntılar açılmadan; liste: `web/tests/quality/lib/jargon.ts`)\n');
  out.push(
    jargon.size === 0
      ? '_Yok._\n'
      : table(
          ['Terim', 'Ekrandaki cümle', 'Nerede'],
          [...jargon.values()].map((entry) => [entry.term, `“${entry.context}”`, [...entry.tasks].join('; ')]),
        ),
  );
  if (mild.size > 0) {
    out.push(`\nYarı teknik (sayıldı, yargılanmadı): ${[...mild.entries()].map(([term, count]) => `${term} × ${num(count, 0)}`).join(' · ')}\n`);
  }

  out.push('\n**Çıkan dosyalar** (ffprobe)\n');
  out.push(
    table(
      ['Görev', 'Görünüm', 'Kaynak', 'Dosya', 'Süre', 'İzler', 'Denetimler'],
      parts
        .flatMap((part) => part.data.tasks)
        .sort((a, b) => TASK_ORDER.indexOf(a.id) - TASK_ORDER.indexOf(b.id) || a.project.localeCompare(b.project))
        .map((task) => [
          task.label,
          task.project === 'phone' ? 'telefon' : 'masaüstü',
          task.sourceNote,
          task.output ? `${kb(task.output.bytes)}${task.output.width ? `, ${task.output.width} × ${task.output.height}` : ''}` : '—',
          task.output ? `${num(task.output.durationS, 2)} sn` : '—',
          task.output ? task.output.streams.join(' + ') : '—',
          task.checks.length === 0 ? '—' : task.checks.map((check) => `${check.ok ? 'tuttu' : '**TUTMADI**'}: ${check.name} (${check.value})`).join('; '),
        ]),
    ),
  );

  out.push('\n**Yazıya dök, baştan sona — TEST KANCALI derleme, betikli tanıyıcı**\n');
  if (standIn.length === 0) {
    out.push('_Koşulmadı._\n');
    M.add('walkthrough', 'walk.standin.run', 'Yazıya dök akışı (betikli tanıyıcı)', null, { note: 'sonuç dosyası yok (koşulmadı)' });
  } else {
    out.push(
      'Bu satırlar `CLIP_TEST_HOOKS=1` derlemesinde, küçük bir model listesi ve konuşmayı DUYMAYAN betikli bir tanıyıcıyla alındı. ' +
        'Ölçülen şey akıştır (tıklama, ekran, kelime, dosyanın çıkması). **Yazının doğruluğu hakkında hiçbir şey söylemez** (bkz. bölüm 6).\n\n',
    );
    out.push(
      table(
        ['Görünüm', 'Dosya çıktı', 'Tıklama', 'Karar ekranı', 'Ekran', 'En kalabalık ekran (kelime)', 'Karttan dosyaya', 'Teknik terim', 'Adıyla bulunamayan'],
        standIn.flatMap((part) =>
          part.data.tasks.map((task) => {
            const id = `walk.standin.${task.project}.yazi`;
            return [
              task.project === 'phone' ? 'telefon' : 'masaüstü',
              M.cell('walkthrough', `${id}.completed`, 'Yazıya dök (betikli tanıyıcı): dosya çıktı', task.completed, { note: task.stopped ?? '' }),
              M.cell('walkthrough', `${id}.clicks`, 'Yazıya dök (betikli tanıyıcı): tıklama', task.clicks, { format: (v) => num(v, 0) }),
              M.cell('walkthrough', `${id}.decisions`, 'Yazıya dök (betikli tanıyıcı): karar ekranı', task.decisions, { format: (v) => num(v, 0) }),
              num(task.screens, 0),
              M.cell('walkthrough', `${id}.wordsMax`, 'Yazıya dök (betikli tanıyıcı): en kalabalık ekran', task.wordsMax, { format: (v) => num(v, 0) }),
              task.timeToResultS === null ? '—' : `${num(task.timeToResultS, 1)} sn (model 360 KB’lık test dosyası)`,
              M.cell('walkthrough', `${id}.strongJargon`, 'Yazıya dök (betikli tanıyıcı): teknik terim', task.strongJargon.length, { format: (v) => num(v, 0) }),
              M.cell('walkthrough', `${id}.unreachable`, 'Yazıya dök (betikli tanıyıcı): adıyla bulunamayan', task.unreachable.length, { format: (v) => num(v, 0) }),
            ];
          }),
        ),
      ),
    );
    const notes = standIn.flatMap((part) => part.data.tasks).flatMap((task) => [
      ...(task.stopped ? [`- ${task.project}: ${task.stopped}`] : []),
      ...task.strongJargon.map((hit) => `- ${task.project}: teknik terim (${hit.screen}) — ${hit.term}: “${hit.context}”`),
      ...task.unreachable.map((item) => `- ${task.project}: adıyla bulunamadı: ${item}`),
    ]);
    if (notes.length > 0) out.push(`\n${[...new Set(notes)].join('\n')}\n`);
  }
  return { md: out.join(''), head };
}

function sectionSearch(results, M) {
  const part = partsOf(results, 'search')[0];
  const head = {};
  if (!part) {
    M.add('search', 'search.run', 'Arama değerlendirmesi', null, { note: 'bu bölümün sonuç dosyası yok (koşulmadı)' });
    return { md: '_Bu bölüm koşulmadı._\n', head };
  }
  const held = part.data.heldOut;
  const dev = part.data.dev;
  const out = [];
  out.push(
    `Ayrı tutulan küme: \`web/tests/quality/data/search-eval.ts\` içindeki \`HELD_OUT\` — ${num(held.phrases, 0)} ifade; bunların ${num(held.seenBefore, 0)}’i ` +
      `arama listelerinin üzerinde ayarlandığı tablolarda (\`tests/unit/taskSearch*.test.ts\`) zaten bulunduğu için **sayılmadı**; sayılan ${num(held.counted, 0)}. ` +
      'Arama bu küme üzerinde ayarlanmadı ve bu çalışmada değiştirilmedi; kaçanlar aşağıda bulgu olarak duruyor.\n\n',
  );
  out.push(
    table(
      ['Ölçü', 'Değer', 'Bütçe', 'Durum'],
      [
        ['İlk sonuç doğru (yapılabilen işler)', 'search.firstHit', held.firstHitPercent, `${num(held.taskPhrases, 0)} ifadede`],
        ['İlk üç sonuçta var', 'search.top3', held.top3Percent, ''],
        ['Yanlış ama emin: ilk sonuç başka iş yapan bir kart (bütün ifadelerde)', 'search.wrongConfident', held.wrongConfidentPercent, `${num(held.counted, 0)} ifadede`],
        ['Yapılabilen işe “Bunu bulamadım.”', 'search.taskNotFound', held.taskNotFoundPercent, ''],
        ['Yapılabilen işe “Bunu henüz yapamıyoruz.”', 'search.taskDenied', held.taskDeniedPercent, ''],
        ['“Bunu henüz yapamıyoruz.” — yakalama (recall)', 'search.cannotRecall', held.cannot.recallPercent, `${num(held.cannot.phrases, 0)} ifadede`],
        ['“Bunu henüz yapamıyoruz.” — isabet (precision)', 'search.cannotPrecision', held.cannot.precisionPercent, `${num(held.cannot.said, 0)} kez söylendi`],
        ['Listede hiç olmayan isteğe dürüst cevap (yapamıyoruz ya da bulamadım)', 'search.outsideHonest', held.outside.honestPercent, `${num(held.outside.phrases, 0)} ifadede; ${num(held.outside.offeredWrongCard, 0)}’ine kart önerildi`],
        ['Anlamsız yazı / sohbete kart önerilmedi', 'search.nothingQuiet', held.nothing.quietPercent, `${num(held.nothing.phrases, 0)} ifadede`],
      ].map(([label, id, value, extra]) => {
        const measure = M.add('search', id, label, value, { format: (v) => pct(v) });
        return [`${label}${extra ? ` — ${extra}` : ''}`, measure.shown, measure.budget ?? '—', STATUS_WORD[measure.status]];
      }),
    ),
  );
  head.firstHit = held.firstHitPercent;
  head.top3 = held.top3Percent;
  head.wrongConfident = held.wrongConfidentPercent;
  head.cannotRecall = held.cannot.recallPercent;

  out.push('\n**İşe göre** (ilk sonuç)\n');
  out.push(
    table(
      ['İş', 'İfade', 'İlk sonuç doğru', 'İlk üçte', 'Yanlış ama emin', 'Bulunamadı'],
      Object.values(held.byTask).map((row) => [row.label, num(row.n, 0), `${num(row.firstHit, 0)} (${pct(row.firstHitPercent)})`, num(row.top3, 0), num(row.wrongConfident, 0), num(row.none, 0)]),
    ),
  );
  const TAG = { tr: 'Türkçe', en: 'İngilizce', yazım: 'yazım hatalı', ascii: 'Türkçe harfsiz', argo: 'argo / kısaltma', uzun: 'uzun cümle' };
  out.push('\n**Yazış biçimine göre** (ilk sonuç; bir ifade birden çok satırda sayılır)\n');
  out.push(table(['Biçim', 'İfade', 'İlk sonuç doğru'], Object.entries(held.byTag).map(([tag, row]) => [TAG[tag] ?? tag, num(row.n, 0), `${num(row.firstHit, 0)} (${pct(row.firstHitPercent)})`])));

  out.push(`\n**Kaçanlar** (${num(held.misses.length, 0)}) — ifade → beklenen → çıkan\n`);
  const EXPECT = { cannot: '“Bunu henüz yapamıyoruz.”', outside: 'kart önerilmemesi', nothing: 'kart önerilmemesi' };
  out.push(
    table(
      ['İfade', 'Beklenen', 'Çıkan', 'Tür'],
      held.misses.map((miss) => [
        `“${miss.text}”`,
        EXPECT[miss.category] ?? miss.expected,
        miss.got,
        miss.wrongConfident ? '**yanlış ama emin**' : miss.top3 ? 'ilk üçte var, ilk değil' : 'bulunamadı',
      ]),
    ),
  );
  out.push(
    `\nGeliştirme kümesi (\`DEV\`, ayar yapılırken kullanılabilir; başlık sayısı değildir): ${num(dev.counted, 0)} ifade, ilk sonuç ${pct(dev.firstHitPercent)}, ` +
      `yanlış ama emin ${pct(dev.wrongConfidentPercent)}, kaçan ${num(dev.misses.length, 0)}` +
      `${dev.misses.length > 0 ? ` (${dev.misses.map((miss) => `“${miss.text}” → ${miss.got}`).join('; ')})` : ''}.\n`,
  );
  return { md: out.join(''), head };
}

const NAME_OF_FIXTURE = { dark: 'karanlık', soft: 'bulanık', noisy: 'kumlu', good: 'iyi' };

const CASE_ORDER = ['yanlis-tur', 'bos', 'bozuk', 'yarim', 'yalniz-ses', 'sessiz-video', 'cok-buyuk', 'cok-uzun'];

function sectionErrors(results, M, taskLabels) {
  const cells = partsOf(results, 'errors').map((part) => part.data);
  const head = {};
  if (cells.length === 0) {
    M.add('errors', 'errors.run', 'Hata yolları', null, { note: 'bu bölümün sonuç dosyası yok (koşulmadı)' });
    return { md: '_Bu bölüm koşulmadı._\n', head };
  }
  const out = [];
  const count = (verdict) => cells.filter((cell) => cell.verdict === verdict).length;
  head.good = count('iyi');
  head.unclear = count('belirsiz');
  head.broken = count('bozuk');
  head.unmeasured = count('ölçülemedi');
  head.cells = cells.length;
  out.push(
    'Her sihirbaza sekiz tür sorunlu dosya verildi; ekranda görülen metin kelimesi kelimesine kaydedildi. Derleme: yayınlanan statik çıktı, masaüstü görünümü ' +
      '(mesajları aynı bileşenler üretir; telefonda ayrıca koşulmadı). Sınır üstü iki durumda dosyanın boyutu ve süresi yalnızca test sayfasının içinde büyük gösterildi; ' +
      'uygulamanın kendi denetimi değişmeden çalıştı.\n\n' +
      '**iyi** = ne olduğunu ve ne yapılacağını söylüyor, ilerleme / geri dönüş var, takılma ve sayfa hatası yok · ' +
      '**belirsiz** = mesaj var ama ne yapılacağını söylemiyor ya da teknik terim içeriyor; ya da sorunlu dosya uyarısız işlendi · ' +
      '**bozuk** = mesaj da ilerleme de yok, bitmeyen bekleme, donan sayfa, sayfa hatası · **ölçülemedi** = bu makinede denenemedi (nedeni tabloda) · **—** = bu iş için hata değil.\n\n',
  );
  const summary = [
    ['İyi', M.add('errors', 'errors.good', 'İyi hücre', head.good, { format: (v) => num(v, 0) })],
    ['Belirsiz', M.add('errors', 'errors.unclear', 'Belirsiz hücre', head.unclear, { format: (v) => num(v, 0) })],
    ['Bozuk', M.add('errors', 'errors.broken', 'Bozuk hücre', head.broken, { format: (v) => num(v, 0) })],
    ['Ölçülemeyen', M.add('errors', 'errors.unmeasured', 'Ölçülemeyen hata hücresi', head.unmeasured, { format: (v) => num(v, 0) })],
    [
      'Sayfanın yanıt vermediği en uzun süre',
      M.add('errors', 'errors.longestUnresponsiveMs', 'Sorunlu dosyada sayfanın yanıt vermediği en uzun süre', Math.max(0, ...cells.map((cell) => cell.longestUnresponsiveMs ?? 0)), {
        format: (v) => `${num(v / 1000, 1)} sn`,
      }),
    ],
    ['Sayfa hatası görülen hücre', M.add('errors', 'errors.pageErrors', 'Sayfa hatası görülen hücre', cells.filter((cell) => cell.pageErrors.length > 0).length, { format: (v) => num(v, 0) })],
    ['Konsol hatası görülen hücre', M.add('errors', 'errors.consoleErrors', 'Konsol hatası görülen hücre', cells.filter((cell) => cell.consoleErrors.length > 0).length, { format: (v) => num(v, 0) })],
  ];
  out.push(table(['', 'Hücre', 'Bütçe', 'Durum'], summary.map(([label, measure]) => [label, measure.shown, measure.budget ?? '—', STATUS_WORD[measure.status]])));

  const cases = CASE_ORDER.filter((id) => cells.some((cell) => cell.case === id));
  const labelOf = (id) => cells.find((cell) => cell.case === id)?.caseLabel ?? id;
  out.push('\n**Tablo** (satır: dosya, sütun: sihirbaz)\n');
  out.push(
    table(
      ['Dosya', ...TASK_ORDER.map((task) => taskLabels[task] ?? task)],
      cases.map((id) => [
        labelOf(id),
        ...TASK_ORDER.map((task) => {
          const cell = cells.find((item) => item.case === id && item.task === task);
          if (!cell) return 'ölçülemedi';
          return cell.verdict === 'geçerli değil' ? '—' : cell.verdict === 'iyi' || cell.verdict === 'ölçülemedi' ? cell.verdict : `**${cell.verdict}**`;
        }),
      ]),
    ),
  );

  // What was actually shown: one row per distinct text and verdict.
  const groups = new Map();
  for (const cell of cells) {
    const PHASE = { saved: 'kaydedildi', ready: 'hazır', failed: 'hata', blocked: 'reddedildi', canceled: 'durduruldu', timeout: 'bitmedi' };
    const text = cell.attempt ? `İndir’e basınca (${PHASE[cell.attempt.phase] ?? cell.attempt.phase}): ${cell.attempt.text}` : (cell.messages ?? []).join(' ');
    const key = `${cell.case}|${cell.verdict}|${text}|${cell.why}`;
    const entry = groups.get(key) ?? { ...cell, text, tasks: [], answer: [] };
    entry.tasks.push(taskLabels[cell.task] ?? cell.task);
    entry.answer.push(cell.answerMs);
    groups.set(key, entry);
  }
  out.push('\n**Ekranda görülen metinler**\n');
  out.push(
    table(
      ['Dosya', 'Sihirbaz', 'Yargı', 'Ekrandaki metin', 'Neden', 'Cevap süresi'],
      [...groups.values()]
        .sort((a, b) => CASE_ORDER.indexOf(a.case) - CASE_ORDER.indexOf(b.case) || a.verdict.localeCompare(b.verdict))
        .map((entry) => [
          entry.caseLabel,
          entry.tasks.length === TASK_ORDER.length ? 'hepsi' : entry.tasks.join(', '),
          entry.verdict,
          entry.text === '' ? '(metin yok)' : `“${entry.text}”`,
          entry.why,
          entry.verdict === 'ölçülemedi' && Math.max(...entry.answer) === 0 ? '—' : `${num(Math.max(...entry.answer) / 1000, 1)} sn`,
        ]),
    ),
  );
  const consoleLines = new Map();
  for (const cell of cells) for (const line of [...cell.pageErrors, ...cell.consoleErrors]) consoleLines.set(line, (consoleLines.get(line) ?? 0) + 1);
  if (consoleLines.size > 0) {
    out.push('\n**Konsola düşen hatalar** (aynı satır bir kez)\n\n');
    out.push([...consoleLines.entries()].map(([line, times]) => `- ${num(times, 0)} hücrede: \`${line.slice(0, 220)}\``).join('\n'));
    out.push('\n');
  }
  return { md: out.join(''), head };
}

function sectionHonesty(results, M, webDir) {
  const parts = partsOf(results, 'honesty').map((part) => part.data);
  const head = {};
  const out = [];
  if (parts.length === 0) {
    M.add('honesty', 'honesty.run', 'Dürüstlük ölçümleri', null, { note: 'bu bölümün sonuç dosyası yok (koşulmadı)' });
    out.push('_Bu bölümün ölçümleri koşulmadı._\n');
  } else {
    const progress = parts.filter((part) => part.kind === 'progress');
    out.push('**İlerleme çubuğu ve “Kaydedildi”** — “İndir”e basıştan sonuca kadar 40 ms’de bir örneklendi (masaüstü, statik çıktı).\n\n');
    out.push(
      table(
        ['Senaryo', 'Sonuç', 'Örnek / farklı değer', 'İlk → son', 'Geri gitti', 'Geçiş arasında geri gitti', '%100’de bekleme', '“Kaydedildi” anında dosya', 'Dosyasız başarı'],
        progress.map((row) => {
          const id = `honesty.${row.id}`;
          if (row.measured === false) {
            for (const key of ['backwards', 'backwardsAcrossPasses', 'msAt100', 'successWithoutFile']) M.add('honesty', `${id}.${key}`, `${row.label}: ${key}`, null, { note: row.reason });
            return [row.label, 'ölçülemedi', '—', '—', 'ölçülemedi', 'ölçülemedi', 'ölçülemedi', '—', 'ölçülemedi'];
          }
          return [
            row.label,
            row.phase,
            `${num(row.progress.samplesWithNumber, 0)} / ${num(row.progress.distinctValues, 0)}`,
            `%${row.progress.first ?? '—'} → %${row.progress.last ?? '—'}`,
            M.cell('honesty', `${id}.backwards`, `${row.label}: ilerleme geri gitti`, row.progress.backwards, { format: (v) => `${num(v, 0)} kez` }),
            M.cell('honesty', `${id}.backwardsAcrossPasses`, `${row.label}: geçişler arasında geri gitti`, row.progress.backwardsAcrossPasses, {
              format: (v) => `${num(v, 0)} kez${row.progress.largestDrop > 0 ? ` (en çok ${num(row.progress.largestDrop, 0)} puan)` : ''}`,
              budgetFormat: (v) => `${num(v, 0)} kez`,
            }),
            M.cell('honesty', `${id}.msAt100`, `${row.label}: dosya yokken %100’de bekleme`, row.progress.msAt100BeforeFile, { format: (v) => `${num(v, 0)} ms` }),
            row.bytesWhenSuccessShown === null ? '—' : `${kb(row.bytesWhenSuccessShown)}${row.file ? `, ${num(row.file.durationS, 2)} sn, ${row.file.streams.join(' + ')}` : ''}`,
            M.cell('honesty', `${id}.successWithoutFile`, `${row.label}: dosyasız “Kaydedildi”`, row.phase === 'saved' ? row.successWithoutFile : null, {
              note: row.phase === 'saved' ? '' : `indirme “${row.phase}” ile bitti`,
            }),
          ];
        }),
      ),
    );
    const measuredProgress = progress.filter((row) => row.measured !== false);
    head.backwards = measuredProgress.length === 0 ? null : measuredProgress.reduce((sum, row) => sum + row.progress.backwards + row.progress.backwardsAcrossPasses, 0);
    const ready = parts.find((part) => part.kind === 'ready-link');
    if (ready) {
      const measure = M.add('honesty', 'honesty.readyLink.successWithoutFile', 'Kaydetme penceresi olmayan yolda “hazır” bağlantısının arkası boş', ready.phase === 'ready' ? ready.successWithoutFile : null, {
        note: ready.phase === 'ready' ? '' : `indirme “${ready.phase}” ile bitti`,
      });
      out.push(
        `\nKaydetme penceresi olmayan yol (telefon, Firefox, Safari): “hazır” dendiğinde bağlantının arkasındaki dosya ${kb(ready.bytesBehindTheLink)}; ` +
          `dosyasız başarı: ${measure.shown} (${STATUS_WORD[measure.status]}).\n`,
      );
    }
    const cancels = parts.filter((part) => part.kind === 'cancel');
    out.push('\n**İptal** — 24 sn’lik video dikey yapılırken, ilerleme %3’ü geçince “İptal et”e basıldı.\n\n');
    out.push(
      table(
        ['Yol', 'Durdu', 'Durma süresi', 'Ekrandaki metin', 'İş sürerken sayfa deposunda', 'İptalden 4 sn sonra kalan', 'Kalan bayt', 'İptalden sonra “kaydedildi”'],
        cancels.map((row) => {
          const id = `honesty.cancel.${row.route}`;
          const routeName = row.route === 'save-dialog' ? 'kaydetme pencereli (Chrome / Edge)' : 'kaydetme penceresiz (telefon, Firefox, Safari)';
          if (row.measured === false) {
            for (const key of ['canceled', 'cancelMs', 'leftoverBytes', 'successAfterCancel']) M.add('honesty', `${id}.${key}`, `İptal (${row.route}): ${key}`, null, { note: row.reason });
            return [routeName, 'ölçülemedi', 'ölçülemedi', '—', '—', '—', 'ölçülemedi', 'ölçülemedi'];
          }
          const running = row.reachedRunning;
          return [
            row.route === 'save-dialog' ? 'kaydetme pencereli (Chrome / Edge)' : 'kaydetme penceresiz (telefon, Firefox, Safari)',
            M.cell('honesty', `${id}.canceled`, `İptal (${row.route}): durdu`, running ? row.canceled : null, { note: 'indirme, iptal edilemeden bitti ya da başlamadı' }),
            M.cell('honesty', `${id}.cancelMs`, `İptal (${row.route}): durma süresi`, row.cancelMs, { format: (v) => `${num(v, 0)} ms`, note: 'iptal gerçekleşmedi' }),
            row.message ? `“${row.message}”` : '—',
            row.filesWhileRunning.map((file) => `${file.name} (${kb(file.bytes)})`).join(', ') || 'dosya yok',
            row.leftovers.map((file) => `${file.name} (${num(file.bytes, 0)} bayt)`).join(', ') || 'hiçbir şey',
            M.cell('honesty', `${id}.leftoverBytes`, `İptal (${row.route}): geride kalan bayt`, running ? row.leftoverBytes : null, { format: (v) => num(v, 0), note: 'iptal gerçekleşmedi' }),
            M.cell('honesty', `${id}.successAfterCancel`, `İptal (${row.route}): sonradan “kaydedildi”`, running ? row.successAfterCancel : null, { note: 'iptal gerçekleşmedi' }),
          ];
        }),
      ),
    );
    const measuredCancels = cancels.filter((row) => row.measured !== false);
    head.leftoverBytes = measuredCancels.length === 0 ? null : measuredCancels.reduce((sum, row) => sum + row.leftoverBytes, 0);
    out.push(
      '\nNot: kaydetme pencereli yolda testin “kaydetme penceresi” kullanıcının seçtiği dosya yerine sayfa deposunda bir dosya verir. ' +
        'İptalden sonra o dosyanın 0 bayt olarak kalması, gerçek pencerede kullanıcının seçtiği adda boş bir dosya kalması demektir; bayt kalması yarım dosya demektir.\n',
    );
  }

  // What the e2e suite already proves: cited, and the citation checked against the spec file.
  const citations = loadJson(join(here, 'citations.json'), { honesty: [] }).honesty;
  out.push('\n**e2e paketinin zaten kanıtladıkları** (burada yeniden ölçülmedi; test adı dosyada arandı)\n\n');
  let missing = 0;
  out.push(
    table(
      ['Ne', 'Test', 'Dosya', 'Atıf'],
      citations.map((item) => {
        const file = join(webDir, item.file);
        const found = existsSync(file) && readFileSync(file, 'utf8').includes(item.title);
        if (!found) missing += 1;
        return [item.what, `“${item.title}”`, `\`web/${item.file}\``, found ? 'dosyada var' : '**BULUNAMADI** (test yeniden adlandırılmış ya da silinmiş olabilir)'];
      }),
    ),
  );
  M.add('honesty', 'honesty.citationsMissing', 'Atıf yapılan ama dosyada bulunamayan e2e testi', missing, { format: (v) => num(v, 0) });
  out.push('\nBu testlerin bu koşuda geçtiği burada İDDİA EDİLMEZ: e2e paketi bu betikle koşulmaz (`npm run test:e2e`, CI).\n');
  return { md: out.join(''), head };
}

function sectionOutput(results, M) {
  const parts = partsOf(results, 'output').map((part) => part.data);
  const head = {};
  if (parts.length === 0) {
    M.add('output', 'output.run', 'Çıktı ölçümleri', null, { note: 'bu bölümün sonuç dosyası yok (koşulmadı)' });
    return { md: '_Bu bölüm koşulmadı._\n', head, speeds: [] };
  }
  const out = [];
  const sources = parts.find((part) => part.kind === 'sources');
  const sync = parts.filter((part) => part.kind === 'sync');
  const picture = parts.filter((part) => part.kind === 'picture');
  const enhance = parts.find((part) => part.kind === 'enhance');
  const METHOD = { copy: 'kopya (yeniden işlenmedi)', encode: 'yeniden işlendi', smart: 'karma (kesim yerleri yeniden işlendi, arası kopya)' };
  const unmeasuredNote = (row) => row.reason ?? 'dosya çıkmadı';

  out.push(
    'Dosyalar uygulamanın kendisiyle (statik çıktı, masaüstü Chromium) üretildi; ölçümler ffmpeg / ffprobe ile yapıldı. ' +
      'Ses–görüntü: `web/scripts/lib/av-sync.mjs` klibi (her olayda bir beyaz kare ve tam o karede başlayan kısa bir ses); sapma = ses eksi görüntü, + ise ses geç.\n\n',
  );
  out.push('**Ses–görüntü eşzamanı ve süre**\n\n');
  if (sources) {
    out.push(
      `Kaynakların kendi sapması: H.264 MP4 ${num(sources.syncMp4.medianMs, 2)} ms (${num(sources.syncMp4.paired, 0)} olay), ` +
        `VP9 WebM ${num(sources.syncWebm.medianMs, 2)} ms (${num(sources.syncWebm.paired, 0)} olay). Tablodaki “eklenen sapma” çıktı eksi kaynak.\n\n`,
    );
  }
  let worstSync = null;
  let worstDuration = null;
  /** Every measured file, for the one "index first" count below. */
  const files = [];
  out.push(
    table(
      ['Durum', 'Yol', 'İstenen → çıkan süre', 'Süre hatası', 'Eşleşen olay', 'Sapma (ortanca; en az … en çok)', 'Eklenen sapma', 'Her yerde açılır (dizin yeri hariç)'],
      sync.map((row) => {
        const id = `out.${row.id}`;
        if (!row.measured) {
          for (const key of ['durationErrorMs', 'avAddedMs', 'playableFailed']) M.add('output', `${id}.${key}`, `${row.label}: ${key}`, null, { note: unmeasuredNote(row) });
          return [row.label, '—', '—', 'ölçülemedi', '—', 'ölçülemedi', 'ölçülemedi', `ölçülemedi (${unmeasuredNote(row)})`];
        }
        const added = row.avSync.medianMs === null || row.avSyncSource.medianMs === null ? null : Math.abs(row.avSync.medianMs - row.avSyncSource.medianMs);
        if (added !== null) worstSync = Math.max(worstSync ?? 0, added);
        worstDuration = Math.max(worstDuration ?? 0, row.durationErrorMs);
        const failed = row.playable.filter((check) => !check.ok && !check.name.startsWith('faststart'));
        files.push({ label: row.label, faststart: row.playable.find((check) => check.name.startsWith('faststart'))?.ok === true });
        return [
          row.label,
          METHOD[row.method] ?? row.method ?? '—',
          `${num(row.requestedS, 2)} → ${num(row.durationS, 3)} sn`,
          M.cell('output', `${id}.durationErrorMs`, `${row.label}: süre hatası`, row.durationErrorMs, { format: (v) => `${num(v, 0)} ms` }),
          `${num(row.avSync.paired, 0)} / ${num(row.avSync.flashes, 0)}`,
          row.avSync.medianMs === null ? 'eşleşen olay yok' : `${num(row.avSync.medianMs, 2)} ms (${num(row.avSync.minMs, 2)} … ${num(row.avSync.maxMs, 2)})`,
          M.cell('output', `${id}.avAddedMs`, `${row.label}: eklenen ses–görüntü sapması`, added, { format: (v) => `${num(v, 2)} ms`, note: 'çıktıda ya da kaynakta eşleşen olay yok' }),
          M.cell('output', `${id}.playableFailed`, `${row.label}: “her yerde açılır” denetimlerinden tutmayan`, failed.length, {
            format: (v) => (v === 0 ? `${num(row.playable.length - 1, 0)} denetimin hepsi tuttu` : `${num(v, 0)} tutmadı: ${failed.map((check) => `${check.name} (${check.value})`).join('; ')}`),
            budgetFormat: (v) => `${num(v, 0)} tutmayan`,
          }),
        ];
      }),
    ),
  );

  out.push('\n**Görüntü sadakati** — aynı düzenlemenin yalnızca ffmpeg ile yapılmış, kayıpsız referansına karşı; kamera benzeri ÜRETİLMİŞ video (gerçek çekim değil).\n\n');
  if (sources && !sources.vmafAvailable) out.push('Bu makinedeki ffmpeg libvmaf içermiyor: VMAF ölçülemedi.\n\n');
  let worstSsim = null;
  let worstVmaf = null;
  out.push(
    table(
      ['Durum', 'Yol', 'Çıktı', 'Karşılaştırma boyutu', 'SSIM', 'PSNR', 'VMAF', 'Süre hatası', 'Hedef boyut', 'Her yerde açılır (dizin yeri hariç)'],
      picture.map((row) => {
        const id = `out.${row.id}`;
        if (!row.measured) {
          for (const key of ['ssim', 'vmaf', 'durationErrorMs', 'playableFailed']) M.add('output', `${id}.${key}`, `${row.label}: ${key}`, null, { note: unmeasuredNote(row) });
          return [row.label, '—', '—', '—', 'ölçülemedi', 'ölçülemedi', 'ölçülemedi', 'ölçülemedi', '—', `ölçülemedi (${unmeasuredNote(row)})`];
        }
        const f = row.fidelity;
        if (f?.ssim !== null && f?.ssim !== undefined) worstSsim = Math.min(worstSsim ?? 1, f.ssim);
        if (f?.vmaf !== null && f?.vmaf !== undefined) worstVmaf = Math.min(worstVmaf ?? 100, f.vmaf);
        worstDuration = Math.max(worstDuration ?? 0, row.durationErrorMs);
        const failed = row.playable.filter((check) => !check.ok && !check.name.startsWith('faststart'));
        files.push({ label: row.label, faststart: row.playable.find((check) => check.name.startsWith('faststart'))?.ok === true });
        let target = '—';
        if (row.targetBytes) {
          const fits = M.cell('output', `${id}.fitsTarget`, `${row.label}: hedefe sığdı`, row.fitsTarget);
          const used = M.cell('output', `${id}.targetUsedPercent`, `${row.label}: hedefin kullanılan payı`, row.targetUsedPercent, { format: (v) => pct(v) });
          target = `${mb(row.bytes)} / ${mb(row.targetBytes, 0)}: sığdı ${fits}, hedefin ${used}’i kullanıldı (kaynak ${mb(row.sourceBytes)})`;
          head.kucultFits = row.fitsTarget;
        }
        return [
          row.label,
          METHOD[row.method] ?? row.method ?? '—',
          `${row.width} × ${row.height}, ${mb(row.bytes)}`,
          row.comparedAt ?? '—',
          M.cell('output', `${id}.ssim`, `${row.label}: SSIM`, f?.ssim ?? null, { format: (v) => num(v, 4), note: row.fidelityError ?? 'ffmpeg puan vermedi' }),
          f?.psnrDb === null || f?.psnrDb === undefined ? 'ölçülemedi' : `${num(f.psnrDb, 2)} dB`,
          M.cell('output', `${id}.vmaf`, `${row.label}: VMAF`, f?.vmaf ?? null, { format: (v) => num(v, 1), note: f?.vmafNote ?? row.fidelityError ?? 'ölçülemedi' }),
          M.cell('output', `${id}.durationErrorMs`, `${row.label}: süre hatası`, row.durationErrorMs, { format: (v) => `${num(v, 0)} ms` }),
          target,
          M.cell('output', `${id}.playableFailed`, `${row.label}: “her yerde açılır” denetimlerinden tutmayan`, failed.length, {
            format: (v) => (v === 0 ? `${num(row.playable.length - 1, 0)} denetimin hepsi tuttu` : `${num(v, 0)} tutmadı: ${failed.map((check) => `${check.name} (${check.value})`).join('; ')}`),
            budgetFormat: (v) => `${num(v, 0)} tutmayan`,
          }),
        ];
      }),
    ),
  );
  if (files.length > 0) {
    const without = files.filter((file) => !file.faststart);
    const measure = M.add('output', 'out.notFaststart', 'Dizini (moov) sonda olan dosya — “faststart” değil', without.length, { format: (v) => `${num(v, 0)} / ${num(files.length, 0)}`, budgetFormat: (v) => num(v, 0) });
    out.push(
      `\n**Dizin başta mı (faststart)?** Dizini dosyanın sonunda olan: ${measure.shown} dosya (${STATUS_WORD[measure.status]}${measure.budget ? `, bütçe ${measure.budget}` : ''}). ` +
        'Dizin sondaysa dosya indirilirken ya da bir sayfaya gömülüyken tamamı gelmeden oynatılamaz; yerel oynatmayı etkilemez. Yukarıdaki “her yerde açılır” sütunu bu denetimi saymaz.\n',
    );
    head.notFaststart = without.length;
  }
  head.worstAvAddedMs = worstSync;
  head.worstDurationErrorMs = worstDuration;
  head.worstSsim = worstSsim;
  head.worstVmaf = worstVmaf;

  out.push('\n**İyileştir** — ADR-037’nin ölçüleri (`web/tests/e2e/enhance-media.ts`: ortalama parlaklık, Laplace varyansı), üretilmiş dört video üzerinde.\n\n');
  if (!enhance || enhance.rows.length === 0) {
    out.push(`_Ölçülemedi: ${enhance?.reason ?? 'sonuç dosyası yok'}._\n`);
    M.add('output', 'out.enhance.run', 'İyileştir ölçümleri', null, { note: enhance?.reason ?? 'sonuç dosyası yok' });
  } else {
    const NAME = { dark: 'karanlık', soft: 'bulanık', noisy: 'kumlu', good: 'iyi (düzeltilecek bir şey yok)' };
    out.push(
      table(
        ['Video', 'Uygulamanın dediği', 'İndirme sunuldu', 'Parlaklık önce → sonra', 'Keskinlik önce → sonra', 'Eklenen en büyük parlaklık sıçraması', 'Kare'],
        enhance.rows.map((row) => {
          const id = `out.enhance.${row.fixture}`;
          const saved = row.phase === 'saved';
          const offered = row.downloadOffered ? 'evet' : 'hayır';
          let luma = saved ? `${num(row.lumaBefore, 1)} → ${num(row.lumaAfter, 1)}` : '—';
          let sharp = saved ? `${num(row.sharpnessBefore, 1)} → ${num(row.sharpnessAfter, 1)}` : '—';
          // "Does no harm": a video that is fine already must stay close to what it was.
          if (row.fixture === 'good' && saved) {
            luma = M.cell('output', `${id}.lumaShift`, 'İyileştir, iyi video: parlaklık kayması', Math.abs(row.lumaAfter - row.lumaBefore), {
              format: (v) => `${num(row.lumaBefore, 1)} → ${num(row.lumaAfter, 1)} (${num(v, 1)} kaydı)`,
              budgetFormat: (v) => num(v, 1),
            });
            sharp = M.cell('output', `${id}.sharpnessRatio`, 'İyileştir, iyi video: keskinlik oranı', row.sharpnessAfter / row.sharpnessBefore, {
              format: (v) => `${num(row.sharpnessBefore, 1)} → ${num(row.sharpnessAfter, 1)} (× ${num(v, 2)})`,
              budgetFormat: (v) => `× ${num(v, 2)}`,
            });
          }
          if (row.fixture === 'dark') {
            luma = M.cell('output', `${id}.lumaGain`, 'İyileştir, karanlık video: parlaklık artışı', saved ? row.lumaAfter - row.lumaBefore : null, {
              format: (v) => `${num(row.lumaBefore, 1)} → ${num(row.lumaAfter, 1)} (+${num(v, 1)})`,
              budgetFormat: (v) => `+${num(v, 1)}`,
              note: 'dosya çıkmadı',
            });
          }
          if (row.fixture === 'soft') {
            sharp = M.cell('output', `${id}.sharpnessRatio`, 'İyileştir, bulanık video: keskinlik oranı', saved ? row.sharpnessAfter / row.sharpnessBefore : null, {
              format: (v) => `${num(row.sharpnessBefore, 1)} → ${num(row.sharpnessAfter, 1)} (× ${num(v, 2)})`,
              budgetFormat: (v) => `× ${num(v, 2)}`,
              note: 'dosya çıkmadı',
            });
          }
          const jump = saved
            ? M.cell('output', `${id}.addedJump`, `İyileştir, ${NAME[row.fixture]}: eklenen parlaklık sıçraması`, row.worstAddedBrightnessJump, { format: (v) => num(v, 2) })
            : '—';
          return [NAME[row.fixture] ?? row.fixture, `“${row.said.text}”`, offered, luma, sharp, jump, saved ? `${num(row.frames, 0)} / ${num(row.sourceFrames, 0)}` : '—'];
        }),
      ),
    );
    out.push('\nGerçek kayıtlardaki “zarar verme” ölçümü (ADR-037, Ölçüm 2; `web/scripts/enhance-eval/no-harm.mjs`) kurucunun kendi videolarını gerektirir; bu betik onlara dokunmaz ve o ölçümü yeniden koşmaz.\n');
  }

  const speeds = [...sync, ...picture]
    .filter((row) => row.measured)
    .map((row) => ({ id: row.id, label: row.label, method: row.method, exportS: row.exportS, durationS: row.durationS, speed: row.speedXRealtime, size: `${row.width} × ${row.height}` }));
  if (enhance) {
    for (const row of enhance.rows.filter((item) => item.phase === 'saved')) {
      speeds.push({
        id: `iyilestir-${row.fixture}`,
        enhance: true,
        accelerated: row.accelerated === true,
        label: `İyileştir, ${NAME_OF_FIXTURE[row.fixture] ?? row.fixture} video`,
        method: 'encode',
        exportS: row.exportS,
        durationS: row.durationS,
        speed: row.speedXRealtime,
        size: '1280 × 720',
      });
    }
  }
  return { md: out.join(''), head, speeds };
}

function sectionTranscript(results, M) {
  const recorded = loadJson(join(here, 'recorded.json'), { transcript: null }).transcript;
  const part = partsOf(results, 'transcript')[0];
  const out = [];
  out.push(
    '**KAYITLI, BU KOŞUDA YENİDEN ÖLÇÜLMEDİ.** Aşağıdaki sayılar ADR-036 çalışmasında, gerçek modellerle ve gerçekçi değerlendirme kümesiyle alındı; ' +
      'bu betik onları bir dosyadan (`web/scripts/quality/recorded.json`) okur, hiçbir şeyi yeniden hesaplamaz.\n\n',
  );
  if (recorded) {
    out.push(`Kaynak: \`${recorded.source}\` — ölçüm tarihi ${recorded.measuredOn}, belgeyi yazan commit \`${recorded.commit}\`, ${recorded.build}.\n\n`);
    out.push(
      table(
        ['Küme, model', 'WER normalize (katı)', 'Konuşma süresinin yazılan payı', 'Koruma attı', 'Hiç duyulmadı', 'Negatifte uydurma metin'],
        recorded.rows.map((row) => [row.set, `${pct(row.werNormalised)} (${pct(row.werStrict)})`, pct(row.writtenPercent), pct(row.droppedPercent), pct(row.unheardPercent), row.invented]),
      ),
    );
    out.push(`\n${recorded.notes.map((note) => `- ${note}`).join('\n')}\n`);
    for (const row of recorded.rows) {
      M.add('transcript', `transcript.recorded.${row.id}.wer`, `Kayıtlı (yeniden ölçülmedi): ${row.set} — WER normalize`, row.werNormalised, { format: (v) => pct(v), note: `kayıtlı, ${recorded.measuredOn}`, stale: true });
      M.add('transcript', `transcript.recorded.${row.id}.written`, `Kayıtlı (yeniden ölçülmedi): ${row.set} — yazılan pay`, row.writtenPercent, { format: (v) => pct(v), note: `kayıtlı, ${recorded.measuredOn}`, stale: true });
    }
  }
  out.push('\n**Bu koşuda gerçek model** (`--with-transcript`)\n\n');
  if (!part) {
    M.add('transcript', 'transcript.live.wer', 'Gerçek küçük model, tek cümle: WER', null, { note: '`--with-transcript` verilmedi; varsayılan koşu modeli çalıştırmaz' });
    out.push('Ölçülmedi: `--with-transcript` verilmedi (varsayılan koşu modeli çalıştırmaz).\n');
  } else if (!part.data.measured) {
    M.add('transcript', 'transcript.live.wer', 'Gerçek küçük model, tek cümle: WER', null, { note: part.data.reason });
    out.push(`Ölçülemedi: ${part.data.reason}.\n`);
  } else {
    const measure = M.add('transcript', 'transcript.live.wer', 'Gerçek küçük model, tek cümle: WER (katı)', part.data.werPercent, { format: (v) => pct(v) });
    out.push(
      `${part.data.clip}, model \`${part.data.model}\`: WER (katı) ${measure.shown} (${STATUS_WORD[measure.status]}${measure.budget ? `, bütçe ${measure.budget}` : ''}); ` +
        `yazıya dökme ${num(part.data.transcribeS, 1)} sn; satırlar: ${part.data.lines.map((line) => `“${line}”`).join(' ')}. ` +
        'Tek cümle bir duman ölçümüdür; yazı kalitesi yukarıdaki kayıtlı tablodur.\n',
    );
  }
  out.push('\nGörev yürüyüşlerindeki “Yazıya dök” satırı betikli bir tanıyıcıyla alınmıştır ve yazı kalitesi DEĞİLDİR (bölüm 1).\n');
  return { md: out.join(''), head: {} };
}

function sectionPerf(results, M, speeds) {
  const parts = partsOf(results, 'perf').map((part) => part.data);
  const head = {};
  const out = [];
  if (parts.length === 0) {
    M.add('perf', 'perf.run', 'Yükleme ölçümleri', null, { note: 'bu bölümün sonuç dosyası yok (koşulmadı)' });
    out.push('_Yükleme ölçümleri koşulmadı._\n');
  } else {
    const PAGE = { 'ana-ekran': 'Ana ekran `/`', sihirbaz: 'Sihirbaz `/yap/dikey/`', editor: 'Editör `/editor/`' };
    const PROFILE = { masaustu: 'bu makine', 'mobil-kisitli': 'mobil kısıtlama (150 ms, 1,6 Mbit/s, 4× yavaş CPU)' };
    out.push(
      'Statik çıktı, gzip’li yerel sunucu (GitHub Pages gibi), her ölçüm yeni tarayıcı bağlamı ve boş önbellek, 3 koşunun ortancası. ' +
        'Baytlar gerçekten aktarılan (sıkıştırılmış) baytlardır. Service worker kapalıydı: ilk ziyaret ölçülür, arka plandaki çevrimdışı indirmesi sayılmaz. ' +
        '“Mobil kısıtlama” masaüstü işlemcide bir öykünmedir, telefon değildir. Yöntem `docs/perf/2026-09-30-load.md` ile aynı.\n\n',
    );
    const rows = [];
    for (const page of parts.filter((part) => part.kind === 'load')) {
      if (page.measured === false) {
        for (const key of ['jsTransferred', 'lcp', 'tbt']) M.add('perf', `perf.${page.id}.masaustu.${key}`, `${page.id}: ${key}`, null, { note: page.reason });
        rows.push([PAGE[page.id] ?? page.id, '—', 'ölçülemedi', '—', '—', 'ölçülemedi', 'ölçülemedi', '—', '—', '—']);
        continue;
      }
      for (const [profile, data] of Object.entries(page.profiles)) {
        const id = `perf.${page.id}.${profile}`;
        const m = data.median;
        const where = `${(PAGE[page.id] ?? page.id).replace(/ `.*$/, '')}, ${profile === 'masaustu' ? 'bu makine' : 'mobil kısıtlama'}`;
        rows.push([
          PAGE[page.id] ?? page.id,
          PROFILE[profile] ?? profile,
          M.cell('perf', `${id}.jsTransferred`, `${where}: aktarılan JS`, m.jsTransferred, { format: (v) => `${kb(v)} (${num(m.jsFiles, 0)} dosya)`, budgetFormat: kb }),
          kb(m.totalTransferred),
          `${num(m.fcp, 0)} ms`,
          M.cell('perf', `${id}.lcp`, `${where}: LCP`, m.lcp, { format: (v) => `${num(v, 0)} ms` }),
          M.cell('perf', `${id}.tbt`, `${where}: TBT`, m.tbt, { format: (v) => `${num(v, 0)} ms` }),
          `${num(m.load, 0)} ms`,
          mb(m.heapAfterLoad),
          M.cell('perf', `${id}.outsideRequests`, `${where}: başka adrese istek`, m.outsideRequests, { format: (v) => num(v, 0) }),
        ]);
        if (page.id === 'ana-ekran' && profile === 'mobil-kisitli') head.homeMobileLcp = m.lcp;
        if (page.id === 'ana-ekran' && profile === 'masaustu') head.homeJsKb = Math.round(m.jsTransferred / 1000);
        if (page.id === 'sihirbaz' && profile === 'mobil-kisitli') head.wizardMobileLcp = m.lcp;
      }
    }
    out.push(table(['Sayfa', 'Profil', 'Aktarılan JS', 'Toplam aktarılan', 'FCP', 'LCP', 'TBT', 'load', 'JS yığını (yükleme sonrası)', 'Dış istek'], rows));
    const heap = parts.find((part) => part.kind === 'heap');
    if (heap) {
      const measure = M.add('perf', 'perf.heap.peakMainThread', 'Dışa aktarma sırasında ana iş parçacığı JS yığını (tepe)', heap.phase === 'saved' ? heap.peakBytes : null, {
        format: (v) => mb(v),
        note: `indirme “${heap.phase}” ile bitti`,
      });
      out.push(
        `\n**Bellek:** 12 sn’lik 1920 × 1080 video dikey yapılırken ana iş parçacığının JS yığını — boşta ${mb(heap.idleBytes)}, video açıkken ${mb(heap.beforeExportBytes)}, ` +
          `tepe ${measure.shown} (${STATUS_WORD[measure.status]}${measure.budget ? `, bütçe ${measure.budget}` : ''}), bittikten sonra ${mb(heap.afterExportBytes)}; ${num(heap.samples, 0)} örnek. ` +
          'Dışa aktarmanın işçileri (worker) ve kodlayıcı bu sayının DIŞINDADIR; bütün süreç ağacının belleği `web/scripts/measure-export-memory.mjs` ile ölçülür (ADR-029), burada yeniden koşulmadı.\n',
      );
      head.heapPeakMb = Math.round(heap.peakBytes / 1_000_000);
    } else {
      M.add('perf', 'perf.heap.peakMainThread', 'Dışa aktarma sırasında ana iş parçacığı JS yığını (tepe)', null, { note: 'sonuç dosyası yok' });
    }
  }
  out.push('\n**Dışa aktarma hızı** — “İndir”e basıştan dosyanın hazır olmasına; × gerçek zaman = çıktı süresi / geçen süre. Ölçüm kilidi altında, bu makinede.\n\n');
  if (speeds.length === 0) {
    M.add('perf', 'perf.speed.run', 'Dışa aktarma hızı', null, { note: 'çıktı bölümü koşulmadı; hız oradan gelir' });
    out.push('_Ölçülemedi: çıktı bölümü koşulmadı._\n');
  } else {
    let slowest = null;
    let slowestEnhance = null;
    let softwareEnhance = false;
    out.push(
      table(
        ['Durum', 'Yol', 'Çıktı', 'Geçen süre', '× gerçek zaman'],
        speeds.map((row) => {
          if (row.method !== 'copy' && !row.enhance) slowest = Math.min(slowest ?? Infinity, row.speed);
          if (row.enhance) slowestEnhance = Math.min(slowestEnhance ?? Infinity, row.speed);
          if (row.enhance && !row.accelerated) softwareEnhance = true;
          return [
            row.label,
            row.method === 'copy' ? 'kopya' : row.method === 'smart' ? 'karma' : row.enhance ? `yeniden işlendi + görüntü işleme${row.accelerated ? '' : ' (grafik hızlandırma YOK)'}` : 'yeniden işlendi',
            `${num(row.durationS, 1)} sn, ${row.size}`,
            `${num(row.exportS, 2)} sn`,
            // İyileştir has its own budget: it also draws every frame, and here it may do so without a graphics card.
            M.cell('perf', `${row.enhance ? 'perf.enhanceSpeed' : 'perf.speed'}.${row.id}`, `${row.label}: hız`, row.speed, { format: (v) => `${num(v, 1)} ×` }),
          ];
        }),
      ),
    );
    head.slowestEncodeX = slowest;
    head.slowestEnhanceX = slowestEnhance;
    if (softwareEnhance) {
      out.push(
        '\nİyileştir satırları grafik hızlandırma olmadan alındı: Playwright’ın Chromium’u bu makinede WebGL’i yazılımla çiziyor (uygulama da bunu söylüyor). ' +
          'Grafik kartı kullanan gerçek bir tarayıcıdaki hız BURADA ÖLÇÜLMEDİ; bu sayı en kötü durumdur.\n',
      );
    }
  }
  return { md: out.join(''), head };
}

function sectionVisual(results, M, docsDir, scratch, baselineCount) {
  const shots = partsOf(results, 'visual').flatMap((part) => part.data.shots);
  const head = {};
  if (shots.length === 0) {
    M.add('visual', 'visual.run', 'Görsel karşılaştırma', null, { note: 'bu bölümün sonuç dosyası yok (koşulmadı)' });
    return { md: '_Bu bölüm koşulmadı._\n', head };
  }
  const out = [];
  const count = (status) => shots.filter((shot) => shot.status === status).length;
  head.shots = shots.length;
  head.different = count('different');
  head.created = count('created') + count('updated');
  out.push(
    `Taban resimler: \`web/tests/quality/baselines/\` (${num(baselineCount, 0)} PNG; Windows’ta Chromium’un sistem yazı tipleriyle çizdiği hâl). ` +
      'Karşılaştırma toleranslıdır: bir pikselin bir renk kanalı 40 / 255’ten fazla ayrışırsa “farklı” sayılır; piksellerin %1’inden fazlası farklıysa ekran “farklı” sayılır. ' +
      'Video, canvas ve saate ya da kodlayıcıya bağlı metinler maskelenir. **CI’da koşulmaz** (aşağıda neden).\n\n',
  );
  const rows = [
    ['Karşılaştırılan ekran', M.add('visual', 'visual.compared', 'Karşılaştırılan ekran', count('same') + count('different'), { format: (v) => num(v, 0) })],
    ['Farklı', M.add('visual', 'visual.different', 'Tabanından farklı ekran', head.different, { format: (v) => num(v, 0) })],
    ['Karşılaştırılamadı', M.add('visual', 'visual.failed', 'Karşılaştırılamayan ekran', count('failed'), { format: (v) => num(v, 0) })],
    ['Bu koşuda taban yazıldı / yenilendi (karşılaştırma değil)', M.add('visual', 'visual.created', 'Bu koşuda tabanı yazılan ekran', head.created, { format: (v) => num(v, 0) })],
  ];
  out.push(table(['', 'Ekran', 'Bütçe', 'Durum'], rows.map(([label, measure]) => [label, measure.shown, measure.budget ?? '—', STATUS_WORD[measure.status]])));

  const diffsOut = join(docsDir, 'diffs');
  rmSync(diffsOut, { recursive: true, force: true });
  const different = shots.filter((shot) => shot.status === 'different');
  if (different.length > 0) {
    mkdirSync(diffsOut, { recursive: true });
    out.push('\n**Farklı ekranlar** (kırmızı: değişen pikseller; gri: taban)\n\n');
    for (const shot of different) {
      const source = shot.diffImage ? join(scratch, 'visual-diffs', shot.diffImage) : null;
      let picture = 'fark resmi bu makinede yok';
      if (source && existsSync(source)) {
        copyFileSync(source, join(diffsOut, shot.diffImage));
        picture = `![${shot.name} ${shot.project}](diffs/${shot.diffImage})`;
      }
      out.push(`- \`${shot.name}\` (${shot.project}): piksellerin ${pct(shot.differentPercent, 2)}’i farklı${shot.note ? `; ${shot.note}` : ''}\n\n  ${picture}\n`);
    }
  }
  const failed = shots.filter((shot) => shot.status === 'failed');
  if (failed.length > 0) out.push(`\nKarşılaştırılamayanlar:\n\n${failed.map((shot) => `- \`${shot.name}\` (${shot.project}): ${shot.note ?? ''}`).join('\n')}\n`);
  out.push('\n**Ekranlar**\n\n');
  const WORD = { same: 'aynı', created: 'taban yazıldı', updated: 'taban yenilendi', different: '**farklı**', failed: '**karşılaştırılamadı**' };
  const names = [...new Set(shots.map((shot) => shot.name))].sort();
  out.push(
    table(
      ['Ekran', 'Masaüstü', 'Telefon'],
      names.map((name) => [
        `\`${name}\``,
        ...['desktop', 'phone'].map((project) => {
          const shot = shots.find((item) => item.name === name && item.project === project);
          if (!shot) return '—';
          return `${WORD[shot.status]}${shot.differentPercent ? ` (${pct(shot.differentPercent, 2)})` : ''}`;
        }),
      ]),
    ),
  );
  out.push(
    '\n**CI kararı:** bu karşılaştırma CI’da kapı değildir ve `.github/workflows/ci.yml` dosyasına eklenmedi. CI da Windows’ta koşar, ama GitHub’ın Windows Server ' +
      'görüntüsündeki yazı tipi çizimi bu makinedekiyle (Windows 11) aynı tabanları verecek mi, ölçülmedi; tabanlar bu makinede üretildi. Kararlı olduğu CI’da gösterilmeden kapı yapılmamalı.\n',
  );
  return { md: out.join(''), head };
}

function sectionA11y(results, M) {
  const parts = partsOf(results, 'a11y');
  const text = partsOf(results, 'text')[0]?.data ?? null;
  const head = {};
  const out = [];
  out.push(
    'Kontrast, rol ve ad kuralları axe ile zaten denetleniyor (`web/tests/e2e/a11y.spec.ts`, `enhance-a11y.spec.ts`, `transcript-a11y.spec.ts`; WCAG 2.2 AA etiketleri); ' +
      'burada tekrar edilmedi. Aşağıdakiler axe’ın ölçmediği şeylerdir.\n\n',
  );
  if (parts.length === 0) {
    M.add('a11y', 'a11y.run', 'Dokunma hedefi, metin boyu, odak sırası', null, { note: 'bu bölümün sonuç dosyası yok (koşulmadı)' });
    out.push('_Tarayıcı ölçümleri koşulmadı._\n');
  } else {
    for (const project of ['phone', 'desktop']) {
      const states = parts.filter((part) => part.part.startsWith(`${project}.`)).map((part) => part.data);
      if (states.length === 0) continue;
      out.push(`**${PROJECT_LABEL[project]}**\n\n`);
      const rows = [];
      let under44 = 0;
      let unnamed = 0;
      let focusProblems = 0;
      for (const original of states) {
        // Measure labels say which view they belong to; the table's first column keeps the plain name.
        const state = { ...original, plain: original.label, label: `${original.label} (${project === 'phone' ? 'telefon' : 'masaüstü'})` };
        const id = `a11y.${project}.${state.id}`;
        if (!state.measured) {
          M.add('a11y', `${id}.run`, `${state.label}`, null, { note: state.reason });
          rows.push([state.plain, 'ölçülemedi', '—', '—', '—', '—', '—', '—', '—']);
          continue;
        }
        under44 += state.tapTargets.under44;
        unnamed += state.names.unnamed;
        focusProblems += state.focus.unreached + state.focus.withoutVisibleRing + (state.wizard ? state.focus.jumpsBack : 0);
        const share = state.text.words === 0 ? 0 : (state.text.wordsUnder14 / state.text.words) * 100;
        rows.push([
          state.plain,
          num(state.controls, 0),
          project === 'phone'
            ? M.cell('a11y', `${id}.under44`, `${state.label}: 44 px’ten küçük dokunma hedefi`, state.tapTargets.under44, { format: (v) => num(v, 0) })
            : `${num(state.tapTargets.under44, 0)} (fareyle; yargılanmaz)`,
          M.cell('a11y', `${id}.under24`, `${state.label}: 24 px’ten küçük hedef`, state.tapTargets.under24, { format: (v) => num(v, 0) }),
          M.cell('a11y', `${id}.unnamed`, `${state.label}: adı olmayan kontrol`, state.names.unnamed, { format: (v) => num(v, 0) }),
          `${num(state.text.smallestPx, 1)} px; ${M.cell('a11y', `${id}.under14Percent`, `${state.label}: 14 px’ten küçük yazılmış kelime payı`, share, { format: (v) => pct(v, 0) })}`,
          M.cell('a11y', `${id}.wordsUnder12`, `${state.label}: 12 px’ten küçük yazılmış kelime`, state.text.wordsUnder12, { format: (v) => num(v, 0) }),
          `${num(state.focus.stops, 0)} durak; ulaşılamayan ${M.cell('a11y', `${id}.unreached`, `${state.label}: Tab ile ulaşılamayan kontrol`, state.focus.unreached, { format: (v) => num(v, 0) })}; ` +
            `geri sıçrama ${state.wizard ? M.cell('a11y', `${id}.jumpsBack`, `${state.label}: odak sırasında geri sıçrama`, state.focus.jumpsBack, { format: (v) => num(v, 0) }) : `${num(state.focus.jumpsBack, 0)} (çok sütunlu; yargılanmaz)`}`,
          M.cell('a11y', `${id}.noRing`, `${state.label}: odak halkası görünmeyen durak`, state.focus.withoutVisibleRing, { format: (v) => num(v, 0) }),
        ]);
      }
      out.push(
        table(
          ['Ekran', 'Kontrol', '44 px’ten küçük hedef', '24 px’ten küçük', 'Adsız kontrol', 'En küçük yazı; 14 px altı kelime', '12 px altı kelime', 'Klavye (Tab) sırası', 'Odak halkası görünmeyen'],
          rows,
        ),
      );
      head[`${project}Under44`] = under44;
      head[`${project}Unnamed`] = unnamed;
      head[`${project}FocusProblems`] = focusProblems;
      const details = [];
      for (const state of states.filter((item) => item.measured)) {
        if (project === 'phone' && state.tapTargets.list.length > 0) details.push(`- **${state.label}** — 44 px’ten küçük: ${state.tapTargets.list.join('; ')}`);
        if (state.names.unnamedList.length > 0) details.push(`- **${state.label}** — adsız: ${state.names.unnamedList.join(', ')}`);
        if (state.focus.unreachedList.length > 0) details.push(`- **${state.label}** — Tab ile ulaşılamayan: ${state.focus.unreachedList.join('; ')}`);
        if (state.wizard && state.focus.jumpExamples.length > 0) details.push(`- **${state.label}** — odak geri sıçradı: ${state.focus.jumpExamples.join('; ')}`);
        if (state.focus.withoutRingList.length > 0) details.push(`- **${state.label}** — odak halkası görünmeyen: ${state.focus.withoutRingList.join('; ')}`);
        if (project === 'phone' && state.text.under14Samples.length > 0) details.push(`- **${state.label}** — küçük yazılar: ${state.text.under14Samples.slice(0, 5).join(' · ')}`);
        if (project === 'phone' && state.names.iconOnlyList.length > 0) details.push(`- **${state.label}** — görünür yazısı olmayan (yalnız simge; adı var): ${state.names.iconOnlyList.join('; ')}`);
        if (project === 'phone' && state.tapTargets.inlineLinks.length > 0) details.push(`- **${state.label}** — cümle içi bağlantı (hedef boyutu yargılanmadı): ${state.tapTargets.inlineLinks.join('; ')}`);
      }
      if (details.length > 0) out.push(`\n${details.join('\n')}\n\n`);
    }
  }

  out.push('\n**Okunabilirlik** — `web/src/i18n/messages.ts` içindeki Türkçe metinler; Ateşman puanı (90–100 çok kolay · 70–89 kolay · 50–69 orta · 30–49 zor · 30 altı çok zor).\n\n');
  if (!text) {
    M.add('a11y', 'text.run', 'Okunabilirlik', null, { note: 'bu bölümün sonuç dosyası yok (koşulmadı)' });
    out.push('_Koşulmadı._\n');
  } else {
    const row = (label, key, data) => [
      label,
      num(data.strings, 0),
      num(data.scoredStrings, 0),
      M.cell('a11y', `text.${key}.medianScore`, `${label}: ortanca Ateşman puanı`, data.medianScore, { format: (v) => num(v, 1) }),
      M.cell('a11y', `text.${key}.hardPercent`, `${label}: “zor” ya da “çok zor” metin payı`, data.hardPercent, { format: (v) => pct(v) }),
      M.cell('a11y', `text.${key}.veryHard`, `${label}: “çok zor” metin`, data.veryHard, { format: (v) => num(v, 0) }),
      M.cell('a11y', `text.${key}.sentencesOver20Words`, `${label}: 20 kelimeden uzun cümlesi olan metin`, data.sentencesOver20Words, { format: (v) => num(v, 0) }),
      `${num(data.longestSentenceWords, 0)} kelime`,
      data.longestWord,
    ];
    out.push(
      table(
        ['Metinler', 'Metin', 'Puanlanan (5+ kelime)', 'Ortanca puan', 'Zor + çok zor', 'Çok zor', '20 kelimeden uzun cümle', 'En uzun cümle', 'En uzun kelime'],
        [row('Varsayılan yol (ana ekran, kartlar, sihirbazlar, yazıya dökme, indirme, hata)', 'defaultPath', text.defaultPath), row('Bütün metinler (editör dahil)', 'all', text.all)],
      ),
    );
    head.readabilityMedian = text.defaultPath.medianScore;
    head.readabilityHardPercent = text.defaultPath.hardPercent;
    const jargon = M.add('a11y', 'text.defaultPath.jargonStrings', 'Varsayılan yolun metinlerinde teknik terim içeren metin', text.jargonDefaultPath.strings, { format: (v) => num(v, 0) });
    out.push(
      `\nVarsayılan yolun metinlerinden teknik terim içeren: ${jargon.shown} (${STATUS_WORD[jargon.status]}${jargon.budget ? `, bütçe ${jargon.budget}` : ''}). ` +
        'Bu, metin tablosunun taramasıdır: bir metnin ekrana hangi koşulda geldiğini bilmez (bir kısmı yalnızca hata olduğunda ya da “Ayrıntılar” açıldığında görünür). ' +
        'Gerçekten görülenler bölüm 1’dedir.\n',
    );
    out.push('\n**En zor 20 metin (varsayılan yol)**\n\n');
    out.push(
      table(
        ['Puan', 'Anahtar', 'Cümle başına kelime', 'Kelime başına hece', 'Metin'],
        text.hardestDefaultPath.map((item) => [`${num(item.score, 1)} (${item.band})`, `\`${item.key}\``, num(item.wordsPerSentence, 1), num(item.syllablesPerWord, 2), `“${item.text}”`]),
      ),
    );
  }
  return { md: out.join(''), head };
}

// ------------------------------------------------------------------ the report

const SECTION_TITLES = [
  ['walkthrough', '1. Görev tamamlama yürüyüşleri'],
  ['search', '2. Arama kalitesi'],
  ['errors', '3. Hata yolları'],
  ['honesty', '4. Dürüstlük denetimleri'],
  ['output', '5. Çıktı kalitesi'],
  ['transcript', '6. Yazıya dökme kalitesi'],
  ['perf', '7. Performans bütçeleri'],
  ['visual', '8. Görsel regresyon'],
  ['a11y', '9. Erişilebilirlik ve çocuk-dostu ölçüler'],
];

/** Which result files feed which report section (for "when was this measured"). */
const SECTION_RESULTS = {
  walkthrough: ['walkthrough', 'walkthrough-yazi'],
  search: ['search'],
  errors: ['errors'],
  honesty: ['honesty'],
  output: ['output'],
  transcript: ['transcript'],
  perf: ['perf', 'output'],
  visual: ['visual'],
  a11y: ['a11y', 'text'],
};

export function writeReport({ webDir, resultsDir, ran, failedSpecs, runSeconds, history, updatedBaselines }) {
  const repoDir = resolve(webDir, '..');
  const docsDir = join(repoDir, 'docs', 'quality');
  const scratch = join(webDir, '.scratch', 'quality');
  mkdirSync(docsDir, { recursive: true });
  const budgets = loadJson(join(here, 'budgets.json'), {});
  const results = loadResults(resultsDir);
  const M = new Measures(Object.fromEntries(Object.entries(budgets).filter(([key]) => !key.startsWith('//'))));

  // Task labels as the app shows them (from the walkthrough results; the registry's own words).
  const taskLabels = {};
  for (const part of [...partsOf(results, 'walkthrough'), ...partsOf(results, 'walkthrough-yazi')]) for (const task of part.data.tasks) taskLabels[task.id] = task.label;

  const baselinesDir = join(webDir, 'tests', 'quality', 'baselines');
  const baselineCount = existsSync(baselinesDir) ? readdirSync(baselinesDir).filter((name) => name.endsWith('.png')).length : 0;

  const built = {};
  built.walkthrough = sectionWalkthrough(results, M);
  built.search = sectionSearch(results, M);
  built.errors = sectionErrors(results, M, taskLabels);
  built.honesty = sectionHonesty(results, M, webDir);
  built.output = sectionOutput(results, M);
  built.transcript = sectionTranscript(results, M);
  built.perf = sectionPerf(results, M, built.output.speeds ?? []);
  built.visual = sectionVisual(results, M, docsDir, scratch, baselineCount);
  built.a11y = sectionA11y(results, M);

  const commit = git(webDir, 'rev-parse --short=7 HEAD') || 'bilinmiyor';
  // The report's own files do not count as "uncommitted changes".
  const dirty = git(repoDir, 'status --porcelain')
    .split(/\r?\n/)
    .some((line) => line.trim() !== '' && !line.slice(3).startsWith('docs/quality/'));
  const now = new Date().toISOString();
  const counts = { ok: 0, over: 0, unmeasured: 0, info: 0 };
  for (const measure of M.list) counts[measure.status] += 1;

  const sectionMeta = {};
  for (const [id] of SECTION_TITLES) {
    const parts = SECTION_RESULTS[id].flatMap((name) => partsOf(results, name));
    const mine = M.list.filter((measure) => measure.section === id);
    sectionMeta[id] = {
      ranNow: (id === 'a11y' ? ['a11y', 'text'] : [id]).some((runnerId) => ran.includes(runnerId)),
      measuredFrom: oldest(parts),
      measuredTo: newest(parts),
      builds: [...new Set(parts.map((part) => part.build))],
      counts: {
        ok: mine.filter((measure) => measure.status === 'ok').length,
        over: mine.filter((measure) => measure.status === 'over').length,
        unmeasured: mine.filter((measure) => measure.status === 'unmeasured').length,
        info: mine.filter((measure) => measure.status === 'info').length,
      },
    };
  }

  const headline = {
    tasksDoneDesktop: built.walkthrough.head.desktopDone ?? null,
    tasksDonePhone: built.walkthrough.head.phoneDone ?? null,
    tasksCounted: built.walkthrough.head.desktopCounted ?? null,
    maxClicksDesktop: built.walkthrough.head.desktopMaxClicks ?? null,
    maxClicksPhone: built.walkthrough.head.phoneMaxClicks ?? null,
    jargonOnDefaultPath: built.walkthrough.head.jargonSentences ?? null,
    searchFirstHitPercent: built.search.head.firstHit ?? null,
    searchTop3Percent: built.search.head.top3 ?? null,
    searchWrongConfidentPercent: built.search.head.wrongConfident ?? null,
    searchCannotRecallPercent: built.search.head.cannotRecall ?? null,
    errorsGood: built.errors.head.good ?? null,
    errorsUnclear: built.errors.head.unclear ?? null,
    errorsBroken: built.errors.head.broken ?? null,
    progressBackwards: built.honesty.head.backwards ?? null,
    cancelLeftoverBytes: built.honesty.head.leftoverBytes ?? null,
    worstAvAddedMs: built.output.head.worstAvAddedMs ?? null,
    worstDurationErrorMs: built.output.head.worstDurationErrorMs ?? null,
    worstSsim: built.output.head.worstSsim ?? null,
    worstVmaf: built.output.head.worstVmaf ?? null,
    kucultFitsTarget: built.output.head.kucultFits ?? null,
    homeLcpMobileMs: built.perf.head.homeMobileLcp ?? null,
    homeJsKb: built.perf.head.homeJsKb ?? null,
    slowestEncodeXRealtime: built.perf.head.slowestEncodeX ?? null,
    visualDifferent: built.visual.head.different ?? null,
    phoneTapTargetsUnder44: built.a11y.head.phoneUnder44 ?? null,
    unnamedControls: built.a11y.head.phoneUnnamed === undefined ? null : (built.a11y.head.phoneUnnamed ?? 0) + (built.a11y.head.desktopUnnamed ?? 0),
    readabilityMedian: built.a11y.head.readabilityMedian ?? null,
    readabilityHardPercent: built.a11y.head.readabilityHardPercent ?? null,
  };

  // ---------------------------------------------------------------- markdown
  const md = [];
  md.push(`# Kalite raporu — ${day(now)}\n\n`);
  md.push(
    `> Üreten: \`npm run quality\` (\`web/scripts/quality/run.mjs\`). Commit \`${commit}\`${dirty ? ' + kaydedilmemiş değişiklikler' : ''}. ` +
      `Rapor ${clock(now)}; bu koşu ${num(Math.round(runSeconds / 60), 0)} dk sürdü` +
      `${ran.length > 0 ? ` ve şu bölümleri yeniden ölçtü: ${ran.join(', ')}` : ' ve hiçbir bölümü yeniden ölçmedi (yalnızca rapor yeniden yazıldı)'}.\n` +
      `> Makine: ${osType()} ${osRelease()}, ${cpus()[0]?.model.trim() ?? 'bilinmeyen işlemci'} × ${cpus().length}, ${num(totalmem() / 1024 ** 3, 0)} GB bellek. ` +
      'Tarayıcı: Playwright’ın Chromium’u. Bütün medya üretilmiş (ffmpeg) ya da depodaki haklı örneklerdir; hiçbir şey makineden çıkmadı.\n' +
      '> Bu rapor bir kullanıcı testinin yerini TUTMAZ; neyi söylemediği en altta ve `docs/quality/README.md` içinde.\n\n',
  );
  if (updatedBaselines) md.push('> **Bu koşu `--update-baselines` ile yapıldı:** ekranlar tabanlarıyla karşılaştırılmadı, tabanlar yeniden yazıldı.\n\n');
  if (failedSpecs.length > 0) md.push(`> **Yarıda kalan ölçüm betikleri:** ${failedSpecs.join('; ')}. İlgili ölçüler “ölçülemedi” olarak durur.\n\n`);

  const findingsFile = join(docsDir, 'findings.md');
  md.push('## Öne çıkan bulgular\n\n');
  if (existsSync(findingsFile)) {
    md.push('_Bu bölüm elle yazılır (`docs/quality/findings.md`); sayılar aşağıdaki tablolardan gelir. Rapor yeniden üretildiğinde olduğu gibi yerine konur — tarihine bakın._\n\n');
    md.push(`${readFileSync(findingsFile, 'utf8').trim()}\n\n`);
  } else {
    md.push('_`docs/quality/findings.md` yok: bulgular henüz yazılmadı._\n\n');
  }

  md.push('## Özet\n\n');
  md.push(
    `${num(M.list.length, 0)} ölçü: **${num(counts.ok, 0)} bütçe içinde**, **${num(counts.over, 0)} bütçe dışı**, ` +
      `**${num(counts.unmeasured, 0)} ölçülemedi**, ${num(counts.info, 0)} bütçesiz (yalnızca bildirilir). Bütçeler: \`web/scripts/quality/budgets.json\`.\n\n`,
  );
  md.push(
    table(
      ['Bölüm', 'Ölçüm zamanı', 'Derleme', 'Bütçe içinde', 'Bütçe dışı', 'Ölçülemedi', 'Bütçesiz'],
      SECTION_TITLES.map(([id, title]) => {
        const meta = sectionMeta[id];
        const BUILD = { static: 'statik çıktı', hooks: 'test kancalı', none: 'tarayıcısız', bilinmiyor: '?' };
        return [
          title,
          meta.measuredTo ? `${clock(meta.measuredTo)}${meta.ranNow ? '' : ' (bu koşuda yenilenmedi)'}` : 'koşulmadı',
          meta.builds.map((build) => BUILD[build] ?? build).join(' + ') || '—',
          num(meta.counts.ok, 0),
          meta.counts.over > 0 ? `**${num(meta.counts.over, 0)}**` : '0',
          meta.counts.unmeasured > 0 ? `**${num(meta.counts.unmeasured, 0)}**` : '0',
          num(meta.counts.info, 0),
        ];
      }),
    ),
  );
  const h = headline;
  md.push('\n**Başlık sayıları**\n\n');
  const or = (value, text) => (value === null || value === undefined ? 'ölçülemedi' : text);
  md.push(
    table(
      ['Ölçü', 'Değer'],
      [
        ['Dosyası doğrulanan görev (Yazıya dök hariç; masaüstü / telefon)', or(h.tasksDoneDesktop, `${num(h.tasksDoneDesktop, 0)} / ${num(h.tasksCounted, 0)} · ${num(h.tasksDonePhone, 0)} / ${num(h.tasksCounted, 0)}`)],
        ['Ana ekrandan dosyaya en çok tıklama (masaüstü / telefon)', or(h.maxClicksDesktop, `${num(h.maxClicksDesktop, 0)} / ${num(h.maxClicksPhone, 0)}`)],
        ['Varsayılan yolda görülen, teknik terim içeren farklı cümle', or(h.jargonOnDefaultPath, num(h.jargonOnDefaultPath, 0))],
        ['Arama: ilk sonuç doğru / ilk üçte / yanlış ama emin', or(h.searchFirstHitPercent, `${pct(h.searchFirstHitPercent)} / ${pct(h.searchTop3Percent)} / ${pct(h.searchWrongConfidentPercent)}`)],
        ['Hata hücreleri: iyi / belirsiz / bozuk', or(h.errorsGood, `${num(h.errorsGood, 0)} / ${num(h.errorsUnclear, 0)} / ${num(h.errorsBroken, 0)}`)],
        ['İlerleme çubuğu geri gitti (kez) · iptalden sonra kalan bayt', or(h.progressBackwards, `${num(h.progressBackwards, 0)} · ${num(h.cancelLeftoverBytes, 0)}`)],
        ['Eklenen ses–görüntü sapması (en kötü) · süre hatası (en kötü)', or(h.worstAvAddedMs, `${num(h.worstAvAddedMs, 2)} ms · ${num(h.worstDurationErrorMs, 0)} ms`)],
        ['Görüntü sadakati, en düşük: SSIM · VMAF', or(h.worstSsim, `${num(h.worstSsim, 4)} · ${h.worstVmaf === null ? 'ölçülemedi' : num(h.worstVmaf, 1)}`)],
        ['Küçült → WhatsApp hedefe sığdı', or(h.kucultFitsTarget, h.kucultFitsTarget ? 'evet' : 'hayır')],
        ['Ana ekran: LCP (mobil kısıtlama) · aktarılan JS', or(h.homeLcpMobileMs, `${num(h.homeLcpMobileMs, 0)} ms · ${num(h.homeJsKb, 0)} KB`)],
        ['En yavaş yeniden işleme hızı', or(h.slowestEncodeXRealtime, `${num(h.slowestEncodeXRealtime, 1)} × gerçek zaman`)],
        ['Tabanından farklı ekran', or(h.visualDifferent, num(h.visualDifferent, 0))],
        ['Telefonda 44 px’ten küçük dokunma hedefi · adsız kontrol', or(h.phoneTapTargetsUnder44, `${num(h.phoneTapTargetsUnder44, 0)} · ${num(h.unnamedControls, 0)}`)],
        ['Okunabilirlik (varsayılan yol): ortanca Ateşman · zor metin payı', or(h.readabilityMedian, `${num(h.readabilityMedian, 1)} · ${pct(h.readabilityHardPercent)}`)],
      ],
    ),
  );

  const over = M.list.filter((measure) => measure.status === 'over');
  md.push(`\n**Bütçe dışı ölçüler** (${num(over.length, 0)})\n\n`);
  md.push(over.length === 0 ? '_Yok._\n' : table(['Ölçü', 'Değer', 'Bütçe'], over.map((measure) => [measure.label, measure.shown, measure.budget])));
  const unmeasured = M.list.filter((measure) => measure.status === 'unmeasured');
  md.push(`\n**Ölçülemeyenler** (${num(unmeasured.length, 0)})\n\n`);
  md.push(unmeasured.length === 0 ? '_Yok._\n' : table(['Ölçü', 'Neden'], unmeasured.map((measure) => [measure.label, measure.note || 'neden kaydedilmedi'])));
  md.push('\nTablolarda **kalın** yazılan değer bütçesinin dışındadır; “ölçülemedi” yazan hücre ölçülememiştir, sıfır değildir.\n');

  for (const [id, title] of SECTION_TITLES) {
    md.push(`\n## ${title}\n\n`);
    md.push(built[id].md);
  }

  md.push('\n## Bu rapor neyi söylemez\n\n');
  md.push(
    [
      '- Bir çocuğun ya da ilk kez kullanan birinin nerede durakladığını, neyi yanlış anladığını, neyi beğenmediğini. Betik hiç duraksamaz ve her düğmenin adını önceden bilir.',
      '- Gerçek telefonu: “telefon” burada masaüstü Chromium’un 390 × 844 dokunmatik öykünmesidir. Gerçek Android / iPhone’da hız, bellek, dosya seçici ve paylaşım ayrı ölçülür (`web/scripts/android/`).',
      '- Gerçek çekimlerde görüntü kalitesini: sadakat ölçüleri üretilmiş, kamera benzeri bir videoda alındı.',
      '- Yazıya dökmenin bugünkü doğruluğunu: bölüm 6 kayıtlı sayılardır.',
      '- e2e testlerinin bu commit’te geçtiğini: atıf yapılan testler burada koşulmaz.',
    ].join('\n'),
  );
  md.push('\n');

  const markdown = join(docsDir, 'latest.md');
  writeFileSync(markdown, md.join(''));

  const json = {
    generatedAt: now,
    commit,
    dirty,
    runSeconds,
    ran,
    failedSpecs,
    updatedBaselines,
    machine: { os: `${osType()} ${osRelease()}`, cpu: cpus()[0]?.model.trim() ?? null, cores: cpus().length, memoryGb: Math.round(totalmem() / 1024 ** 3) },
    counts,
    headline,
    sections: sectionMeta,
    measures: M.list,
  };
  writeFileSync(join(docsDir, 'latest.json'), `${JSON.stringify(json, null, 2)}\n`);

  if (history) {
    appendFileSync(
      join(docsDir, 'history.jsonl'),
      `${JSON.stringify({ date: now, commit, dirty, runSeconds, ran, counts, headline })}\n`,
    );
  }
  return { markdown, counts, headline };
}
