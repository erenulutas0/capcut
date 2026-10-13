'use client';

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

import { extractSound } from '@/adapters/cloud/cloudAudioClient';
import { recordFailure } from '@/adapters/diagnostics';
import { deleteJob, fetchQuota, fetchResult, fetchStatus, startJob } from '@/adapters/cloud/cloudClient';
import { CLOUD_ORIGIN } from '@/adapters/cloud/cloudConfig';
import { readInvite, removeInvite, saveInvite, subscribeInvite, tidyInvite } from '@/adapters/cloud/inviteStore';
import type { CaptionImportResult, ImportedCueInput } from '@/application/commands';
import { withBasePath } from '@/basePath';
import { FailureDetails } from '@/components/FailureDetails';
import { Icon } from '@/components/Icon';
import { DEFAULT_CAPTION_STYLE } from '@/domain/captions';
import {
  cloudCues,
  cloudEstimateMinutes,
  cloudGiveUpMs,
  minutesVerdict,
  parseCloudResult,
  type CloudFailure,
  type CloudQuota,
} from '@/domain/cloudTranscript';
import type { CaptionUnclearV3 } from '@/domain/edl';
import type { ExportFailureDetail } from '@/domain/exportFailureDetail';
import { formatBytes } from '@/domain/policy';
import { CUE_RULES } from '@/domain/subtitleSegmentation';
import type { Micros } from '@/domain/time';
import { lineClock } from '@/domain/transcript';
import { cloudTranslator, type CloudMessageKey } from '@/i18n/cloudMessages';
import { translator } from '@/i18n/messages';
import { frameTest, type Transcription } from './useTranscription';

const t = translator('tr');
const ct = cloudTranslator('tr');

const fill = (template: string, values: Record<string, string>): string => template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);

/** `**word**` in a sentence of the message table → bold on screen. */
function Emphasis({ text }: { text: string }) {
  return (
    <>
      {text.split('**').map((part, index) => (index % 2 === 1 ? <strong key={index}>{part}</strong> : part))}
    </>
  );
}

/** What the wizard needs once a cloud transcript is in the recipe (the route's own words travel with it). */
export interface CloudApplied {
  /** This browser's name for the job the result came from: a later update for the same result carries it again. */
  jobId: string;
  /** True for the second call, which only adds the minutes left to the summary. */
  update: boolean;
  /** "12 satır yazıldı. 3 ayrı kişi ayırt edildi. 37 dakikan kaldı." */
  summary: string;
  /** "İnternette yazıldı — yanlış olabilir, düzeltebilirsin." */
  machineNote: string;
  /** First line of the downloaded text file. */
  fileHeader: string;
  /** Said at the foot of the result screen instead of "Videon cihazından çıkmaz." */
  footer: string;
  /** Said near the result until the editor is opened: the text is not stored yet, and what keeps it. */
  keepNote: string;
}

export interface CloudRouteProps {
  video: { file: File; durationUs: Micros };
  transcription: Transcription;
  /** Puts the result into the recipe (one undo step) and says what happened. */
  apply: (cues: readonly ImportedCueInput[], unclear: readonly CaptionUnclearV3[], language?: string) => CaptionImportResult;
  /** The on-device steps, shown once "Cihazımda yaz" was pressed. */
  deviceSteps: ReactNode;
  /** Starts the on-device transcription (the model is in this browser). */
  startDevice: () => void;
  /** The heading and the footer this screen wants while it shows (null: the wizard's own). */
  onView: (view: { title: string | null; footer: string | null }) => void;
  onApplied: (result: CloudApplied) => void;
}

type QuotaState =
  | { kind: 'none' }
  | { kind: 'checking' }
  | { kind: 'ready'; quota: CloudQuota }
  | { kind: 'problem'; reason: CloudFailure };

type Phase =
  | { kind: 'idle' }
  | { kind: 'preparing'; doneS: number | null; totalS: number | null }
  | { kind: 'uploading'; sentBytes: number; totalBytes: number }
  | { kind: 'writing'; startedAt: number }
  | { kind: 'fetching' };

/** What the last attempt ended with, said above the two cards. */
interface Notice {
  text: string;
  /** For "Ayrıntılar": where the sound file's making broke, when nobody planned for it (ADR-042). Never the error's text. */
  detail?: ExportFailureDetail;
  /**
   * What became of the sound that had been sent; null when nothing was passed on.
   * - `deleted`: the job had started, and the proxy deleted it (and its sound) at the provider;
   * - `unstarted`: stopped before the job started — there is no transcript to delete, and a sound the
   *   provider received without one cannot be deleted by us (it removes those itself, by its own rules);
   * - `pending`: the delete could not be asked for now; the proxy's own clean-up does it.
   */
  cleanup: 'deleted' | 'unstarted' | 'pending' | null;
}

/** '1' only in a test build (`CLIP_TEST_HOOKS=1`); the published site is built with ''. */
const TEST_HOOKS = process.env.NEXT_PUBLIC_CLIP_TEST_HOOKS === '1';
/** Test builds only: a test may shorten the wait after which a job is given up. */
function giveUpMs(durationUs: Micros): number {
  if (TEST_HOOKS) {
    const hook = (globalThis as { __clipCloudTest?: { giveUpMs?: unknown } }).__clipCloudTest;
    if (typeof hook?.giveUpMs === 'number') return hook.giveUpMs;
  }
  return cloudGiveUpMs(durationUs);
}

function newJobId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      window.clearTimeout(timer);
      resolve();
    }, { once: true });
  });

/** One attempt: how to stop it, and whether a job may exist at the proxy (then a delete is owed). */
interface Run {
  abort: AbortController;
  jobId: string;
  invite: string;
  /** The sound may have reached the proxy (the upload began and was not refused at the door). */
  sent: boolean;
  /** The proxy said the job started (it answered 202). */
  accepted: boolean;
}

/** Asks the proxy to delete the job of an attempt, if one may exist. Null: nothing had been sent. */
async function deleteRun(run: Run | null, keepalive = false): Promise<Notice['cleanup']> {
  if (!run || !run.sent) return null;
  const deleted = await deleteJob({
    origin: CLOUD_ORIGIN,
    invite: run.invite,
    jobId: run.jobId,
    keepalive,
    ...(keepalive ? {} : { signal: AbortSignal.timeout(15_000) }),
  });
  return deleted ? (run.accepted ? 'deleted' : 'unstarted') : 'pending';
}

/** Seconds since `startedAt`, ticking once a second while mounted. */
function useElapsedSeconds(startedAt: number | null): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (startedAt === null) return undefined;
    const tick = () => setSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [startedAt]);
  return startedAt === null ? 0 : seconds;
}

/**
 * "Yazıyı nerede çıkaralım?" (ADR-039; the founder's option B, "İki yol yan
 * yana"): two cards of the same weight — on this device, or on the internet —
 * and everything the internet card leads to.
 *
 * The rules this component keeps:
 * - Nothing is chosen for the user and nothing is remembered: the screen
 *   opens on the two cards every time, neither marked.
 * - Not one byte of the video's sound leaves before "Sesi gönder ve yaz" is
 *   pressed. (With a saved invite code, the screen asks our proxy how many
 *   minutes are left: that request carries the code, no sound. Without a
 *   saved code the screen makes no request at all.)
 * - Only a sound-only file made on this device is sent (`cloudAudioWorker`).
 * - Every number shown is real: seconds of sound prepared, bytes handed to
 *   the network, minutes the proxy counted. No percentage is made up; while
 *   the provider works there is no number, so none is shown.
 * - Every way it can fail says what happened, deletes what was sent when it
 *   can, and leaves "Cihazımda yaz" one press away.
 *
 * This file and everything it imports from `adapters/cloud` exist only in a
 * build that names the proxy; the wizard loads it lazily behind that check.
 */
export default function CloudRoute({ video, transcription, apply, deviceSteps, startDevice, onView, onApplied }: CloudRouteProps) {
  const uid = useId();
  const mark = t('time.decimalMark');
  const [route, setRoute] = useState<'choose' | 'device'>('choose');
  const invite = useSyncExternalStore(subscribeInvite, readInvite, () => null);
  /** What the proxy last said about the minutes, and for which code and which asking it said it. */
  const [answer, setAnswer] = useState<{ invite: string; asked: number; state: QuotaState } | null>(null);
  const [asked, setAsked] = useState(0);
  const [typed, setTyped] = useState('');
  const [inviteError, setInviteError] = useState<CloudMessageKey | null>(null);
  const [inviteNote, setInviteNote] = useState<CloudMessageKey | null>(null);
  const [savingInvite, setSavingInvite] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [notice, setNotice] = useState<Notice | null>(null);
  const aliveRef = useRef(true);
  /** The code whose minutes came back when it was saved: the screen does not ask a second time for it. */
  const freshRef = useRef<string | null>(null);
  /** The running attempt. */
  const runRef = useRef<Run | null>(null);
  const noticeRef = useRef<HTMLDivElement | null>(null);
  const statusRef = useRef<HTMLParagraphElement | null>(null);
  const elapsed = useElapsedSeconds(phase.kind === 'writing' ? phase.startedAt : null);
  const busy = phase.kind !== 'idle';

  // ------------------------------------------------------------ minutes left (only with a saved code)
  const quota: QuotaState = !invite ? { kind: 'none' } : answer && answer.invite === invite && answer.asked === asked ? answer.state : { kind: 'checking' };
  useEffect(() => {
    if (!invite) return undefined;
    if (freshRef.current === invite) {
      // Saved a moment ago: the answer that accepted it is the answer.
      freshRef.current = null;
      return undefined;
    }
    const abort = new AbortController();
    void fetchQuota({ origin: CLOUD_ORIGIN, invite, signal: abort.signal }).then((result) => {
      if (abort.signal.aborted) return;
      if (result.ok) setAnswer({ invite, asked, state: { kind: 'ready', quota: result.quota } });
      else if (result.reason === 'invite_invalid') {
        // The code was withdrawn: it is no use keeping it.
        removeInvite();
        setInviteNote('cloud.invite.expired');
      } else if (result.reason !== 'canceled') setAnswer({ invite, asked, state: { kind: 'problem', reason: result.reason } });
    });
    return () => abort.abort();
  }, [invite, asked]);

  // ------------------------------------------------------------ what the wizard's frame shows
  const choosing = route === 'choose' && !busy;
  useEffect(() => {
    onView({ title: choosing ? ct('cloud.choice.title') : null, footer: busy ? ct('cloud.footer.sending') : null });
  }, [choosing, busy, onView]);
  useEffect(() => () => onView({ title: null, footer: null }), [onView]);

  // Focus follows what replaced the pressed button: the status while it runs, the notice when it ended.
  const previousKind = useRef(phase.kind);
  useEffect(() => {
    const before = previousKind.current;
    previousKind.current = phase.kind;
    if (before === 'idle' && phase.kind !== 'idle') statusRef.current?.focus();
    else if (before !== 'idle' && phase.kind === 'idle') noticeRef.current?.focus();
  }, [phase.kind]);

  // ------------------------------------------------------------ stopping, and never leaving a job behind
  useEffect(() => {
    aliveRef.current = true;
    // The tab is closed or the page left in the middle of a job: stop it and ask for the delete on the way out.
    const leave = () => {
      const run = runRef.current;
      if (!run) return;
      run.abort.abort();
      void deleteRun(run, true);
    };
    window.addEventListener('pagehide', leave);
    return () => {
      aliveRef.current = false;
      window.removeEventListener('pagehide', leave);
      // Another video was picked, or the wizard was left: the same.
      leave();
      runRef.current = null;
    };
  }, []);

  /** An attempt ended without a transcript: delete what was sent, then say what happened. */
  const end = async (run: Run, text: string, detail?: ExportFailureDetail) => {
    const cleanup = await deleteRun(run);
    if (runRef.current === run) runRef.current = null;
    if (!aliveRef.current) return;
    setNotice({ text, cleanup, ...(detail ? { detail } : {}) });
    setPhase({ kind: 'idle' });
    // Minutes may have changed (a job that ran is counted): ask again.
    setAsked((n) => n + 1);
  };

  const stop = () => {
    const run = runRef.current;
    if (run && !run.abort.signal.aborted) run.abort.abort();
  };

  // ------------------------------------------------------------ "Sesi gönder ve yaz"
  const send = async () => {
    if (!invite || runRef.current) return;
    const abort = new AbortController();
    const run: Run = { abort, jobId: newJobId(), invite, sent: false, accepted: false };
    runRef.current = run;
    const signal = abort.signal;
    const call = { origin: CLOUD_ORIGIN, invite, signal };
    const fail = (reason: CloudFailure | 'canceled', detail?: ExportFailureDetail) =>
      end(run, reason === 'canceled' ? ct('cloud.stopped') : ct(`cloud.failed.${reason}` as CloudMessageKey), detail);
    setNotice(null);
    setInviteNote(null);
    setPhase({ kind: 'preparing', doneS: null, totalS: null });

    // 1. The sound-only file, made here. Nothing has been sent yet.
    const sound = await extractSound(
      video.file,
      (doneS, totalS) => {
        if (aliveRef.current && !signal.aborted) setPhase({ kind: 'preparing', doneS, totalS });
      },
      signal,
    );
    if (!sound.ok) {
      const reason = sound.reason;
      // For "Sorun bildir": the code, and the detail of an unexpected failure. Nothing was sent.
      if (reason !== 'canceled') recordFailure('cloud_audio', reason, sound.detail);
      return fail(
        reason === 'canceled'
          ? 'canceled'
          : reason === 'encoder_unavailable' || reason === 'worker_unavailable'
            ? 'audio_unavailable'
            : reason === 'internal_error'
              ? 'internal_error'
              : 'audio_unreadable',
        sound.detail,
      );
    }

    // 2. Send it. From here a job may exist at the proxy: every ending asks for its deletion.
    run.sent = true;
    if (aliveRef.current) setPhase({ kind: 'uploading', sentBytes: 0, totalBytes: sound.blob.size });
    const started = await startJob({
      ...call,
      jobId: run.jobId,
      audio: sound.blob,
      mime: sound.mime,
      durationS: sound.durationS,
      onProgress: (progress) => {
        if (aliveRef.current && !signal.aborted) setPhase({ kind: 'uploading', ...progress });
      },
    });
    if (!started.ok) {
      // Refused at the proxy's door: nothing was passed on, there is nothing to delete.
      if (started.refused) run.sent = false;
      return fail(started.reason);
    }
    run.accepted = true;

    // 3. Wait for the provider. There is no honest number for this part, so none is shown — only the clock.
    const startedAt = Date.now();
    if (aliveRef.current) setPhase({ kind: 'writing', startedAt });
    const deadline = startedAt + giveUpMs(video.durationUs);
    let unreachable = 0;
    for (let round = 0; ; round += 1) {
      await sleep(Math.min(5000, 1000 * (1 + Math.floor(round / 2))), signal);
      if (signal.aborted) return fail('canceled');
      const status = await fetchStatus({ ...call, jobId: run.jobId });
      if (!status.ok) {
        if (status.reason === 'canceled') return fail('canceled');
        // A dropped poll is not the end of the job: a few are forgiven.
        if (status.reason === 'unreachable' && (unreachable += 1) <= 4) continue;
        return fail(status.reason);
      }
      unreachable = 0;
      if (status.status === 'completed') break;
      if (status.status === 'error') return fail('provider_error');
      if (Date.now() > deadline) return fail('timeout');
    }

    // 4. The text. It is in this browser before anything is said to be done.
    if (aliveRef.current) setPhase({ kind: 'fetching' });
    const fetched = await fetchResult({ ...call, jobId: run.jobId });
    if (!fetched.ok) return fail(fetched.reason);
    const result = parseCloudResult(fetched.body, video.durationUs);
    if (!result) return fail('provider_error');
    if (result.words.length === 0) return fail('empty');
    const fits = await frameTest(DEFAULT_CAPTION_STYLE);
    const cues = cloudCues(result, video.durationUs, CUE_RULES, fits);
    if (signal.aborted) return fail('canceled');
    if (cues.length === 0) return fail('empty');
    // Each line goes in with the voice that said it: the recipe stores it (EDL v5, ADR-043).
    const applied = apply(cues, [], result.language ?? undefined);
    if (!applied.ok) return fail(applied.reason === 'caption_import_empty' ? 'empty' : 'internal_error');

    // The result is on screen from this moment (the wizard shows the transcript): its words go with it at once.
    const sentences = [
      fill(ct('cloud.done'), { lines: String(applied.report.imported) }),
      applied.report.skipped.length > 0 ? fill(ct('cloud.done.skipped'), { n: String(applied.report.skipped.length) }) : '',
      result.speakers >= 2 ? fill(ct('cloud.done.speakers'), { n: String(result.speakers) }) : '',
    ].filter(Boolean);
    const done: CloudApplied = {
      jobId: run.jobId,
      update: false,
      summary: sentences.join(' '),
      machineNote: ct('cloud.machine'),
      fileHeader: ct('cloud.file.header'),
      footer: ct('cloud.footer.sent'),
      keepNote: ct('cloud.keep.note'),
    };
    // This attempt is over: the wizard now shows the transcript and takes this screen away, which must not
    // read as "stopped in the middle".
    runRef.current = null;
    onApplied(done);

    // 5. Tell the proxy to delete (it also does so itself once the result has passed through), then the minutes left.
    await deleteJob({ origin: CLOUD_ORIGIN, invite, jobId: run.jobId, signal: AbortSignal.timeout(15_000) });
    const after = await fetchQuota({ origin: CLOUD_ORIGIN, invite });
    if (after.ok) onApplied({ ...done, update: true, summary: [...sentences, fill(ct('cloud.done.minutes'), { y: String(after.quota.remainingMinutes) })].join(' ') });
    return undefined;
  };

  // ------------------------------------------------------------ the invite code
  const saveCode = async () => {
    const code = tidyInvite(typed);
    setInviteNote(null);
    if (!code) {
      // Not sent anywhere: it cannot be an invite code.
      setInviteError('cloud.invite.bad');
      return;
    }
    setInviteError(null);
    setSavingInvite(true);
    const result = await fetchQuota({ origin: CLOUD_ORIGIN, invite: code });
    if (!aliveRef.current) return;
    setSavingInvite(false);
    if (result.ok) {
      freshRef.current = code;
      setAnswer({ invite: code, asked, state: { kind: 'ready', quota: result.quota } });
      setTyped('');
      saveInvite(code);
    } else if (result.reason === 'invite_invalid') setInviteError('cloud.invite.invalid');
    else if (result.reason === 'off') setInviteError('cloud.invite.off');
    else setInviteError('cloud.invite.unreachable');
  };

  const forgetCode = () => {
    removeInvite();
    setInviteError(null);
    setInviteNote('cloud.invite.removed');
  };

  const chooseDevice = () => {
    setNotice(null);
    setRoute('device');
    // The model is here already: "Cihazımda yaz" means write, not another screen with another button.
    if (transcription.status?.ready === true && transcription.job.kind === 'idle') startDevice();
  };

  // ------------------------------------------------------------ the on-device steps
  if (route === 'device') {
    const deviceBusy = transcription.job.kind === 'downloading' || transcription.job.kind === 'transcribing';
    return (
      <>
        {deviceSteps}
        {deviceBusy ? null : (
          <button type="button" className="link-button wizard-more" onClick={() => setRoute('choose')} data-testid="route-back">
            {ct('cloud.device.back')}
          </button>
        )}
      </>
    );
  }

  // ------------------------------------------------------------ while a job runs
  if (phase.kind !== 'idle') {
    const size = (bytes: number) => formatBytes(bytes, mark);
    const [now, max]: [number | null, number] =
      phase.kind === 'preparing' && phase.doneS !== null && phase.totalS !== null && phase.totalS > 0
        ? [Math.min(phase.doneS, phase.totalS), phase.totalS]
        : phase.kind === 'uploading' && phase.totalBytes > 0
          ? [phase.sentBytes, phase.totalBytes]
          : [null, 0];
    const words =
      phase.kind === 'preparing'
        ? phase.doneS !== null && phase.totalS !== null
          ? fill(ct('cloud.run.preparingProgress'), { done: lineClock(phase.doneS * 1_000_000), total: lineClock(phase.totalS * 1_000_000) })
          : ct('cloud.run.preparing')
        : phase.kind === 'uploading'
          ? fill(ct('cloud.run.uploading'), { done: size(phase.sentBytes), total: size(phase.totalBytes) })
          : phase.kind === 'writing'
            ? ct('cloud.run.writing')
            : ct('cloud.run.fetching');
    return (
      <div className="wizard-panel" data-testid="cloud-running" data-phase={phase.kind}>
        <p className="wizard-panel-title" role="status" tabIndex={-1} ref={statusRef} data-testid="cloud-phase">
          {words}
        </p>
        <div
          className="progress-track"
          role="progressbar"
          aria-label={ct('cloud.online.go')}
          aria-valuemin={0}
          aria-valuemax={max}
          {...(now === null ? {} : { 'aria-valuenow': now, 'aria-valuetext': words })}
        >
          <div
            className={now === null ? 'progress-fill progress-indeterminate' : 'progress-fill'}
            style={now === null ? undefined : { width: `${(now / max) * 100}%` }}
          />
        </div>
        {phase.kind === 'writing' ? (
          <p className="wizard-hint" data-testid="cloud-elapsed">
            {fill(ct('cloud.run.elapsed'), { time: lineClock(elapsed * 1_000_000) })}
          </p>
        ) : null}
        <p className="wizard-hint">{ct('cloud.run.note')}</p>
        <button type="button" className="btn route-stop" onClick={stop} data-testid="cloud-stop">
          {ct('cloud.run.stop')}
        </button>
      </div>
    );
  }

  // ------------------------------------------------------------ the two cards
  const verdict = quota.kind === 'ready' ? minutesVerdict(quota.quota, video.durationUs) : null;
  const canSend = invite !== null && verdict?.kind === 'fits';
  const modelBytes = transcription.status && !transcription.status.ready ? transcription.status.missingBytes : null;
  const deviceModelLine = modelBytes !== null && modelBytes > 0 ? fill(ct('cloud.device.model'), { size: formatBytes(modelBytes, mark) }) : null;

  return (
    <div className="route" data-testid="route-choice" data-invite={invite ? 'saved' : 'none'} data-quota={quota.kind}>
      {notice ? (
        <div className="wizard-blocked route-notice" role="alert" tabIndex={-1} ref={noticeRef} data-testid="cloud-notice">
          <p>{notice.text}</p>
          <FailureDetails t={t} detail={notice.detail} testId="cloud-failed" />
          {notice.cleanup ? (
            <p data-testid="cloud-cleanup" data-cleanup={notice.cleanup}>
              {ct(`cloud.cleanup.${notice.cleanup}` as CloudMessageKey)}
            </p>
          ) : null}
        </div>
      ) : (
        // Kept in the page so the notice can take the focus the moment it appears.
        <div ref={noticeRef} tabIndex={-1} hidden />
      )}

      <div className="route-cards">
        <section className="route-card" aria-labelledby={`${uid}-device`} data-testid="route-device">
          <h2 className="route-card-title" id={`${uid}-device`}>
            <Icon name="taskVertical" />
            {ct('cloud.device.title')}
          </h2>
          <p className="route-card-body">{ct('cloud.device.body')}</p>
          <p className="route-card-meta" data-testid="route-device-time">
            {ct('cloud.device.time')}
            {deviceModelLine ? ` ${deviceModelLine}` : ''}
          </p>
          <button type="button" className="btn wizard-go route-go route-go-device" onClick={chooseDevice} data-testid="route-device-go">
            {ct('cloud.device.go')}
          </button>
        </section>

        <section className="route-card" aria-labelledby={`${uid}-online`} data-testid="route-online">
          <h2 className="route-card-title route-card-title-online" id={`${uid}-online`}>
            <Icon name="cloud" />
            {ct('cloud.online.title')}
          </h2>
          <p className="route-card-body">{ct('cloud.online.body')}</p>
          <ul className="route-facts" data-testid="route-facts">
            {(['cloud.online.fact.sound', 'cloud.online.fact.who', 'cloud.online.fact.deleted', 'cloud.online.fact.others'] as const).map((key) => (
              <li key={key}>
                <Emphasis text={ct(key)} />
              </li>
            ))}
          </ul>

          {inviteNote ? (
            <p className="route-card-meta" role="status" data-testid="invite-note">
              {ct(inviteNote)}
            </p>
          ) : null}

          {invite === null ? (
            <form
              className="route-invite"
              onSubmit={(event) => {
                event.preventDefault();
                void saveCode();
              }}
              data-testid="invite-form"
            >
              <p className="route-card-meta" id={`${uid}-need`}>
                {ct('cloud.invite.need')}
              </p>
              <label className="route-invite-label" htmlFor={`${uid}-code`}>
                {ct('cloud.invite.label')}
              </label>
              <input
                id={`${uid}-code`}
                className="route-invite-field"
                type="text"
                inputMode="text"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                value={typed}
                onChange={(event) => {
                  setTyped(event.target.value);
                  setInviteError(null);
                }}
                aria-invalid={inviteError !== null}
                aria-describedby={`${uid}-need ${uid}-hint${inviteError ? ` ${uid}-error` : ''}`}
                disabled={savingInvite}
                data-testid="invite-code"
              />
              {inviteError ? (
                <p className="wizard-blocked" role="alert" id={`${uid}-error`} data-testid="invite-error">
                  {ct(inviteError)}
                </p>
              ) : null}
              <p className="route-card-meta" id={`${uid}-hint`}>
                {ct('cloud.invite.hint')}
              </p>
              <button type="submit" className="btn wizard-go route-go route-go-save" disabled={savingInvite || typed.trim() === ''} data-testid="invite-save">
                {ct(savingInvite ? 'cloud.invite.saving' : 'cloud.invite.save')}
              </button>
            </form>
          ) : (
            <>
              {quota.kind === 'checking' ? (
                <p className="route-card-meta" role="status" data-testid="route-minutes" data-state="checking">
                  {ct('cloud.online.checking')}
                </p>
              ) : null}
              {quota.kind === 'problem' ? (
                <>
                  <p className="wizard-blocked" role="status" data-testid="route-minutes" data-state={quota.reason}>
                    {ct(quota.reason === 'off' ? 'cloud.online.off' : quota.reason === 'unreachable' ? 'cloud.online.unreachable' : (`cloud.failed.${quota.reason}` as CloudMessageKey))}
                  </p>
                  <button type="button" className="btn route-small" onClick={() => setAsked((n) => n + 1)} data-testid="route-retry">
                    {ct('cloud.online.retry')}
                  </button>
                </>
              ) : null}
              {verdict?.kind === 'fits' ? (
                <p className="route-card-meta" data-testid="route-minutes" data-state="fits">
                  {fill(ct('cloud.online.minutes'), {
                    n: String(cloudEstimateMinutes(video.durationUs)),
                    x: String(verdict.charged),
                    y: String(verdict.left),
                  })}
                </p>
              ) : null}
              {verdict && verdict.kind !== 'fits' ? (
                <p className="wizard-blocked" data-testid="route-minutes" data-state={verdict.kind}>
                  {verdict.kind === 'not_enough'
                    ? fill(ct('cloud.online.notEnough'), { x: String(verdict.charged), y: String(verdict.remaining) })
                    : verdict.kind === 'too_long'
                      ? fill(ct('cloud.online.tooLong'), { max: String(verdict.maxJobMinutes) })
                      : ct('cloud.online.off')}
                </p>
              ) : null}
              {canSend ? (
                <button type="button" className="btn btn-accent wizard-go route-go" onClick={() => void send()} data-testid="route-online-go">
                  {ct('cloud.online.go')}
                </button>
              ) : null}
            </>
          )}
        </section>
      </div>

      <div className="route-privacy">
        {/* A new tab: leaving the wizard would close the video opened in it. */}
        <a href={withBasePath('/gizlilik')} target="_blank" rel="noopener" data-testid="route-privacy">
          {ct('cloud.privacyLink')}
          <span className="visually-hidden"> — {ct('cloud.newTab')}</span>
        </a>
        {/* Under both cards, so the two ways forward end on the same line. */}
        {invite !== null ? (
          <button type="button" className="link-button route-forget" onClick={forgetCode} data-testid="invite-remove">
            {ct('cloud.invite.remove')}
          </button>
        ) : null}
      </div>
    </div>
  );
}
