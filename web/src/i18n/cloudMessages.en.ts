/**
 * English for the cloud transcript route (ADR-039). A module of its own,
 * loaded only where English is shown (the English privacy page): importing
 * it registers the language with `cloudTranslator('en')`.
 */

import { APP_NAME } from '../appIdentity';
import { registerCloudMessages, type CloudMessageKey } from './cloudMessages';

export const cloudEn: Record<CloudMessageKey, string> = {
  'cloud.choice.title': 'Where should we write the text?',
  'cloud.device.title': 'On my device',
  'cloud.device.body': 'Nothing is sent. Slower, a little less accurate. Does not tell speakers apart.',
  'cloud.device.time': 'English only for now. It can take about half the length of the speech; longer on a slow device.',
  'cloud.device.model': 'The first time, a {size} model is downloaded.',
  'cloud.device.go': 'Write on my device',
  'cloud.device.back': 'Back: where should we write the text?',
  'cloud.online.title': 'On the internet',
  'cloud.online.body': 'More accurate, much faster. Also tells speakers apart.',
  'cloud.online.fact.sound': '**Only the sound** is sent, not the picture.',
  'cloud.online.fact.who': 'It goes to a company called **AssemblyAI**. Its computers are in Europe.',
  'cloud.online.fact.deleted': 'When the text arrives, the sound and the text there are **deleted**.',
  'cloud.online.fact.others': 'If other people speak in it, **their voices are sent too**.',
  'cloud.online.minutes': 'Takes about {n} min · uses {x} min, {y} min left',
  'cloud.online.go': 'Send the sound and write',
  'cloud.online.checking': 'Asking how many minutes you have left…',
  'cloud.online.notEnough': 'This video has {x} minutes of sound; you have {y} minutes left. Not enough. We can write it on your device.',
  'cloud.online.tooLong': 'This video is too long: at most {max} minutes of sound can be written on the internet. We can write it on your device.',
  'cloud.online.off': 'We cannot write on the internet right now. We can write it on your device.',
  'cloud.online.unreachable': 'We could not reach the writer on the internet. Check your connection; we can also write it on your device.',
  'cloud.online.retry': 'Try again',
  'cloud.invite.need': 'You need an invite code to use this.',
  'cloud.invite.label': 'Invite code',
  'cloud.invite.save': 'Save the code',
  'cloud.invite.saving': 'Checking the code…',
  'cloud.invite.hint': 'The code is kept on this device; you can remove it whenever you like.',
  'cloud.invite.bad': 'This does not look like an invite code. A code is four groups of letters and digits separated by dashes.',
  'cloud.invite.invalid': 'This invite code is not valid. Check it and type it again.',
  'cloud.invite.expired': 'Your saved invite code is no longer valid. You can type a new one.',
  'cloud.invite.unreachable': 'We could not check the code: the writer on the internet could not be reached. Check your connection and try again.',
  'cloud.invite.off': 'Your code is right, but we cannot write on the internet right now. We can write it on your device.',
  'cloud.invite.remove': 'Remove the invite code',
  'cloud.invite.removed': 'The invite code was removed from this device.',
  'cloud.privacyLink': 'Privacy page',
  'cloud.newTab': 'opens in a new tab',

  'cloud.run.preparing': 'Preparing the sound',
  'cloud.run.preparingProgress': 'Preparing the sound: {done} / {total}',
  'cloud.run.uploading': 'Sending: {done} / {total}',
  'cloud.run.writing': 'Writing…',
  'cloud.run.fetching': 'Getting the text…',
  'cloud.run.elapsed': 'Time so far {time}.',
  'cloud.run.note': 'Only the sound is sent; the picture stays on your device. Keep this tab open until it is done.',
  'cloud.run.stop': 'Stop',
  'cloud.stopped': 'Stopped; no text was written.',

  'cloud.failed.unreachable': 'We could not reach the writer on the internet. Check your connection and try again, or write it on your device.',
  'cloud.failed.off': 'We cannot write on the internet right now. We can write it on your device.',
  'cloud.failed.invite_invalid': 'Your invite code is not valid. Type a new one, or write it on your device.',
  'cloud.failed.minutes_used_up': 'You do not have enough minutes for this video. We can write it on your device.',
  'cloud.failed.too_long': 'This video is too long to write on the internet. We can write it on your device.',
  'cloud.failed.busy': 'Another writing job is running with this invite code. Try again when it is done, or write it on your device.',
  'cloud.failed.rate_limited': 'Too many tries. Try again in a while, or write it on your device.',
  'cloud.failed.upload_interrupted': 'Sending was cut off; no text was written. Check your connection and try again, or write it on your device.',
  'cloud.failed.provider_error': 'It did not work: the writer on the internet could not write this sound. Try again, or write it on your device.',
  'cloud.failed.empty': 'The text came back empty: no speech to write was found in this sound. You can try on your device.',
  'cloud.failed.timeout': 'It took too long, so we stopped; no text was written. Try again, or write it on your device.',
  'cloud.failed.audio_unavailable': 'This browser cannot prepare the video’s sound for sending; nothing was sent. We can write it on your device.',
  'cloud.failed.audio_unreadable': 'The sound of this video could not be read; nothing was sent. You can try on your device.',
  'cloud.failed.internal_error': 'Something went wrong; no text was written. Try again, or write it on your device.',
  'cloud.cleanup.deleted': 'The sound that was sent has been deleted there.',
  'cloud.cleanup.unstarted':
    'The writing job was stopped. If any of the sent sound is still there, AssemblyAI says it deletes it within two days at most.',
  'cloud.cleanup.pending': 'We could not delete the sent sound just now; our server keeps trying by itself.',

  'cloud.done': '{lines} lines written.',
  'cloud.done.skipped': '{n} lines were skipped because they break the subtitle rules.',
  'cloud.done.speakers': '{n} different people were told apart.',
  'cloud.done.minutes': 'You have {y} minutes left.',
  'cloud.machine': 'Written on the internet — it may be wrong, and you can correct it.',
  'cloud.file.header': `Written automatically on the internet with ${APP_NAME} — it may be wrong.`,
  'cloud.footer.sending': 'Only the sound is sent; the picture does not leave your device.',
  'cloud.footer.sent': 'The sound of this video was sent to the internet to be written; its picture did not leave your device.',

  'cloud.privacy.summary.local':
    'The video, audio and subtitle files you choose are processed in this browser, on your own device. One exception: if you choose “On the internet” in “Yazıya dök”, only the sound of the video is sent (see “Writing on the internet” below). Nothing is sent unless you choose it.',
  'cloud.privacy.summary.report':
    'The app sends nothing by itself; sound is sent only when you press “Sesi gönder ve yaz”. If you want to report a problem, you download the diagnostics file and you send it.',
  'cloud.privacy.network.extra':
    'The one exception is “Writing on the internet”: if you choose it, your browser also makes requests to our relay server. Details are below.',
  'cloud.privacy.notCollected.body':
    'An account or e-mail address, analytics or usage statistics, cookies, an advertising ID, a device fingerprint, location, automatic error or crash reports. The picture of your video is not collected either. The sound of your video and its written text leave your device only if you choose “On the internet”; if you choose “On my device”, neither does.',
  'cloud.privacy.stored.none': 'Cookies are not used. localStorage holds only the hint above and (if you saved one) your invite code; sessionStorage holds only the reload note above.',
  'cloud.privacy.title': 'Writing on the internet (optional, invited trial)',
  'cloud.privacy.intro':
    '“Yazıya dök” has two ways: “On my device” and “On the internet”. The internet way works only with an invite code and starts each time only when you press “Sesi gönder ve yaz”; it is never chosen for you, and your choice is not remembered.',
  'cloud.privacy.what':
    'What is sent: only the sound of the video (speech, background sounds, music). The sound is prepared on your device as a new audio file. The picture, the file name, location and device details are not sent.',
  'cloud.privacy.who':
    'Who receives it: the sound passes through our relay server (it runs on Cloudflare) to a company called AssemblyAI, which writes the text. Our relay server does not keep the sound or the text; it only passes them on.',
  'cloud.privacy.region': 'Where it is processed: on AssemblyAI’s servers in the European Union.',
  'cloud.privacy.deletion':
    'When it is deleted: once the text has arrived on your device, a request to delete the sound and the text there is sent. If the request fails, our server tries again. After that the text exists only in this browser.',
  'cloud.privacy.kept':
    'Where the text is on your device: at first only in the open page; if you close the page it is gone. If you press “Daha fazla ayar → editörde aç”, its lines and who spoke are kept in this browser as a project (see “Project recipe” below). If a project you kept earlier is there, you are asked which one stays. To delete it: press “Delete the saved project” when the editor asks for the video file again, or clear this site’s data in the browser settings.',
  'cloud.privacy.stored.project.extra':
    'The same for a text written on the internet: if you open it in the editor, the text of its lines and who spoke are kept here; the sound, your invite code and the company’s reply are not.',
  'cloud.privacy.others': 'If other people speak in the video, their voices are sent too. Think about that before you send.',
  'cloud.privacy.ledger':
    'What our relay server records: a digest of the invite code, the length and size of the sound, the state and time of the job (90 days); to prevent overuse, a digest of the IP address (for about an hour at most). The sound, the text and the file name are not recorded. Like every internet server, Cloudflare sees the IP address while carrying the request.',
  'cloud.privacy.quota':
    'If your invite code is saved, it is sent to our relay server when the “Yazıyı nerede çıkaralım?” screen opens, to ask how many minutes you have left. That request carries no sound.',
  'cloud.privacy.trial':
    'This way is an invited trial. The data controller and the legal basis are shown as “not decided” below; it will not be opened beyond the trial before they are decided.',
  'cloud.privacy.stored.invite.name': 'Invite code (writing on the internet)',
  'cloud.privacy.stored.invite.body':
    'Kept in this browser so you only type your invite code once. It is written only when you press “Kodu kaydet” and the code is accepted.',
  'cloud.privacy.stored.invite.where': 'localStorage, key “clip.cloudInvite”',
  'cloud.privacy.stored.invite.delete': 'With the “Remove the invite code” button below, or the same button on the “Yazıya dök” screen.',
  'cloud.privacy.invite.present': 'An invite code is saved in this browser.',
  'cloud.privacy.invite.absent': 'No invite code is saved in this browser.',
};

registerCloudMessages('en', cloudEn);
