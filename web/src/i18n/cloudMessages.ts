/**
 * The words of the cloud transcript route (ADR-039), in a table of their own.
 *
 * Why not in `messages.ts`: that table is in every page of every build, and
 * the route exists only in a build that names the proxy
 * (`NEXT_PUBLIC_CLOUD_TRANSCRIPT_URL`). Kept here, a build without it does
 * not even carry these sentences — the published site says nothing about a
 * company it sends nothing to.
 *
 * The consent screen's wording is the founder's choice of 11 Oct 2026
 * (option B, "İki yol yan yana"; record in docs/ux/2026-10-11-cloud-consent).
 * Rules for every sentence here (ADR-039 "Rıza ekranı"): nothing we cannot
 * show to be true — no "güvenli", "şifreli", "anonim", "kimse dinlemez",
 * "eğitimde kullanılmaz" — and no number that was not measured or counted.
 * `**…**` marks the words the screen shows in bold.
 */

import { APP_NAME } from '../appIdentity';
import type { Locale } from './messages';

export const cloudTr = {
  // ------------------------------------------------------------ the choice ("İki yol yan yana")
  'cloud.choice.title': 'Yazıyı nerede çıkaralım?',
  'cloud.device.title': 'Cihazımda',
  'cloud.device.body': 'Hiçbir şey gitmez. Daha yavaş, biraz daha az doğru. Kimin konuştuğunu ayırmaz.',
  // No invented number: the on-device time depends on the device (ADR-036 wording).
  'cloud.device.time': 'Şimdilik yalnızca İngilizce. Konuşmanın süresinin yarısı kadar sürebilir; yavaş cihazda daha uzun.',
  'cloud.device.model': 'İlk seferde {size} model indirilir.',
  'cloud.device.go': 'Cihazımda yaz',
  'cloud.device.back': 'Geri: yazıyı nerede çıkaralım?',
  'cloud.online.title': 'İnternette',
  'cloud.online.body': 'Daha doğru, çok daha hızlı. Kimin konuştuğunu da ayırır.',
  'cloud.online.fact.sound': '**Yalnızca ses** gider, görüntü gitmez.',
  'cloud.online.fact.who': '**AssemblyAI** adlı bir şirkete gider. Bilgisayarları Avrupa’da.',
  'cloud.online.fact.deleted': 'Yazı gelince oradaki ses ve yazı **silinir**.',
  'cloud.online.fact.others': 'Başka insanlar konuşuyorsa **onların sesi de gider**.',
  'cloud.online.minutes': 'Yaklaşık {n} dakika sürer · {x} dakika düşer, {y} dakikan kalır',
  'cloud.online.go': 'Sesi gönder ve yaz',
  'cloud.online.checking': 'Kalan dakikan soruluyor…',
  'cloud.online.notEnough': 'Bu videonun sesi {x} dakika; {y} dakikan kaldı. Yetmiyor. Cihazında yazabiliriz.',
  'cloud.online.tooLong': 'Bu video çok uzun: internette en çok {max} dakikalık ses yazılabiliyor. Cihazında yazabiliriz.',
  'cloud.online.off': 'Şu an internette yazamıyoruz. Cihazında yazabiliriz.',
  'cloud.online.unreachable': 'İnternetteki yazıcıya ulaşamadık. İnternet bağlantına bak; cihazında da yazabiliriz.',
  'cloud.online.retry': 'Yeniden dene',
  'cloud.invite.need': 'Bunu kullanmak için davet kodu gerekiyor.',
  'cloud.invite.label': 'Davet kodu',
  'cloud.invite.save': 'Kodu kaydet',
  'cloud.invite.saving': 'Kod kontrol ediliyor…',
  'cloud.invite.hint': 'Kod bu cihazda saklanır; istediğinde kaldırabilirsin.',
  'cloud.invite.bad': 'Bu bir davet koduna benzemiyor. Kod, tireyle ayrılmış dört grup harf ve rakamdır.',
  'cloud.invite.invalid': 'Bu davet kodu geçmiyor. Kodu kontrol edip yeniden yaz.',
  'cloud.invite.expired': 'Kayıtlı davet kodun artık geçmiyor. Yeni bir kod yazabilirsin.',
  'cloud.invite.unreachable': 'Kodu kontrol edemedik: internetteki yazıcıya ulaşamadık. İnternet bağlantına bakıp yeniden dene.',
  'cloud.invite.off': 'Kodun doğru, ama şu an internette yazamıyoruz. Cihazında yazabiliriz.',
  'cloud.invite.remove': 'Davet kodunu kaldır',
  'cloud.invite.removed': 'Davet kodu bu cihazdan kaldırıldı.',
  'cloud.privacyLink': 'Gizlilik sayfası',
  'cloud.newTab': 'yeni sekmede açılır',

  // ------------------------------------------------------------ while it runs (real numbers only)
  'cloud.run.preparing': 'Ses hazırlanıyor',
  'cloud.run.preparingProgress': 'Ses hazırlanıyor: {done} / {total}',
  'cloud.run.uploading': 'Gönderiliyor: {done} / {total}',
  'cloud.run.writing': 'Yazılıyor…',
  'cloud.run.fetching': 'Yazı alınıyor…',
  'cloud.run.elapsed': 'Geçen süre {time}.',
  'cloud.run.note': 'Yalnızca ses gönderilir; görüntü cihazında kalır. Bitene kadar bu sekmeyi açık tut.',
  'cloud.run.stop': 'Durdur',
  'cloud.stopped': 'Durduruldu; yazı çıkmadı.',

  // ------------------------------------------------------------ every way it can fail — and the way forward
  'cloud.failed.unreachable': 'İnternetteki yazıcıya ulaşamadık. İnternet bağlantına bakıp yeniden dene ya da cihazında yaz.',
  'cloud.failed.off': 'Şu an internette yazamıyoruz. Cihazında yazabiliriz.',
  'cloud.failed.invite_invalid': 'Davet kodun geçmiyor. Yeni bir kod yaz ya da cihazında yaz.',
  'cloud.failed.minutes_used_up': 'Dakikan bu video için yetmiyor. Cihazında yazabiliriz.',
  'cloud.failed.too_long': 'Bu video internette yazmak için çok uzun. Cihazında yazabiliriz.',
  'cloud.failed.busy': 'Bu davet koduyla başka bir yazma işi sürüyor. Bitince yeniden dene ya da cihazında yaz.',
  'cloud.failed.rate_limited': 'Çok sık denendi. Bir süre sonra yeniden dene ya da cihazında yaz.',
  'cloud.failed.upload_interrupted': 'Gönderme yarıda kesildi; yazı çıkmadı. İnternet bağlantına bakıp yeniden dene ya da cihazında yaz.',
  'cloud.failed.provider_error': 'Olmadı: internetteki yazıcı bu sesi yazamadı. Yeniden dene ya da cihazında yaz.',
  'cloud.failed.empty': 'Yazı boş geldi: bu seste yazıya dökülecek konuşma bulunamadı. İstersen cihazında dene.',
  'cloud.failed.timeout': 'Çok uzun sürdü, durdurduk; yazı çıkmadı. Yeniden dene ya da cihazında yaz.',
  'cloud.failed.audio_unavailable': 'Bu tarayıcı videonun sesini gönderilecek hâle getiremiyor; hiçbir şey gönderilmedi. Cihazında yazabiliriz.',
  'cloud.failed.audio_unreadable': 'Bu videonun sesi okunamadı; hiçbir şey gönderilmedi. Cihazında deneyebilirsin.',
  'cloud.failed.internal_error': 'Bir şey ters gitti; yazı çıkmadı. Yeniden dene ya da cihazında yaz.',
  // What happened to the sound that was already sent: said only when it was sent, and only what the proxy answered.
  'cloud.cleanup.deleted': 'Gönderilen ses oradan silindi.',
  // Stopped before the job started: there is no transcript to delete, and we cannot delete a sound the provider
  // received without one. What it does with such a sound is ITS statement (ADR-039 quotes the page), said as such.
  'cloud.cleanup.unstarted':
    'Yazma işi durduruldu. Gönderilen sesten orada kalan olduysa, AssemblyAI bunu en geç iki gün içinde sildiğini söylüyor.',
  'cloud.cleanup.pending': 'Gönderilen sesi şimdi silemedik; sunucumuz silmeyi kendiliğinden yeniden dener.',

  // ------------------------------------------------------------ the result
  'cloud.done': '{lines} satır yazıldı.',
  'cloud.done.skipped': '{n} satır altyazı kurallarına uymadığı için atlandı.',
  'cloud.done.speakers': '{n} ayrı kişi ayırt edildi.',
  'cloud.done.minutes': '{y} dakikan kaldı.',
  'cloud.machine': 'İnternette yazıldı — yanlış olabilir, düzeltebilirsin.',
  'cloud.file.header': `${APP_NAME} ile internette otomatik yazıldı — yanlış olabilir.`,
  'cloud.footer.sending': 'Yalnızca ses gönderilir; görüntü cihazından çıkmaz.',
  'cloud.footer.sent': 'Bu videonun sesi yazıya dökülmek için internete gönderildi; görüntüsü cihazından çıkmadı.',

  // Keeping the text at the hand-over to the editor (ADR-034 addendum, 13 Oct 2026) is the wizard's own,
  // for the on-device transcript too: its words are `wizard.yazi.keep*` in messages.ts.

  // ------------------------------------------------------------ the privacy page (only in a build that has the route)
  'cloud.privacy.summary.local':
    'Seçtiğin video, ses ve altyazı dosyaları bu tarayıcıda, kendi cihazında işlenir. Tek istisna: “Yazıya dök”te “İnternette”yi sen seçersen videonun yalnızca sesi gönderilir (aşağıda “İnternette yazıya dökme”). Sen seçmedikçe hiçbir şey gönderilmez.',
  'cloud.privacy.summary.report':
    'Uygulama kendiliğinden hiçbir şey göndermez; ses yalnızca “Sesi gönder ve yaz”a bastığında gider. Sorun bildirmek istersen tanı dosyasını sen indirir, sen gönderirsin.',
  'cloud.privacy.network.extra':
    'Bunun tek istisnası “İnternette yazıya dökme”dir: onu sen seçersen tarayıcın bizim aracı sunucumuza da istek yapar. Ayrıntısı aşağıda.',
  'cloud.privacy.notCollected.body':
    'Hesap veya e-posta, analitik ya da kullanım istatistiği, çerez, reklam kimliği, cihaz parmak izi, konum, otomatik hata veya çökme raporu. Videonun görüntüsü de toplanmaz. Videonun sesi ve yazıya dökülmüş metni yalnızca sen “İnternette”yi seçersen cihazından çıkar; “Cihazımda”yı seçersen hiçbiri çıkmaz.',
  'cloud.privacy.stored.none': 'Çerez kullanılmaz. localStorage’da yalnızca yukarıdaki ipucu bilgisi, (büyük model burada durduysa) büyük model notu ve (kaydettiysen) davet kodun, sessionStorage’da yalnızca yukarıdaki yeniden yükleme notu durur.',
  'cloud.privacy.title': 'İnternette yazıya dökme (isteğe bağlı, davetli deneme)',
  'cloud.privacy.intro':
    '“Yazıya dök”te iki yol vardır: “Cihazımda” ve “İnternette”. İnternette yolu yalnızca davet koduyla çalışır ve her seferinde sen “Sesi gönder ve yaz”a basınca başlar; kendiliğinden seçilmez, seçimin hatırlanmaz.',
  'cloud.privacy.what':
    'Ne gider: videonun yalnızca sesi (konuşmalar, arka plandaki sesler, müzik). Ses, cihazında yeni bir ses dosyası olarak hazırlanır. Görüntü, dosya adı, konum ve cihaz bilgisi gitmez.',
  'cloud.privacy.who':
    'Kime gider: ses bizim aracı sunucumuzdan (Cloudflare üzerinde çalışır) geçerek AssemblyAI adlı şirkete gider; yazıyı o çıkarır. Aracı sunucumuz sesi ve yazıyı saklamaz, yalnızca geçirir.',
  'cloud.privacy.region': 'Nerede işlenir: AssemblyAI’nin Avrupa Birliği’ndeki sunucularında.',
  'cloud.privacy.deletion':
    'Ne zaman silinir: yazı cihazına gelince oradaki ses ve yazı için silme isteği gönderilir. İstek başarısız olursa sunucumuz yeniden dener: yazı alınmadıysa 60 dakika sonra, her durumda en geç 24 saat içinde; olmazsa 10 dakikada bir. Yazı bundan sonra yalnızca bu tarayıcıda durur.',
  // What the provider does when our deletion never happens: ITS documented rule (ADR-039 quotes the pages, read 10 Oct 2026), said as such.
  'cloud.privacy.retention':
    'Silme hiç yapılamazsa (örneğin gönderme yarıda kesildiyse) AssemblyAI’nin kendi kuralı geçer. Şirketin belgesine göre gönderilen ses en geç 48 saatte silinir; yazı 30 gün sonra kendiliğinden silinmeye başlar. Silinen işin kimliği ve süresi faturalama için orada kalır.',
  // No promise we cannot keep either way (ADR-039 "Rıza ekranı": never "eğitimde kullanılmaz").
  'cloud.privacy.training':
    'Sesin bu şirketin yapay zekâ modellerini eğitmekte kullanılmayacağına dair biz bir söz veremiyoruz; bunu şirketin kendi kuralları belirler.',
  'cloud.privacy.provider': 'AssemblyAI’nin kendi belgeleri (İngilizce):',
  'cloud.privacy.provider.retention': 'Saklama ve model eğitimi',
  'cloud.privacy.provider.dpa': 'Veri işleme sözleşmesi',
  'cloud.privacy.kept':
    'Yazı cihazında nerede durur: önce yalnızca açık sayfada; sayfayı kapatırsan gider. “Daha fazla ayar → editörde aç”a basarsan, satırları ve kimin konuştuğu bu tarayıcıda proje olarak saklanır (aşağıda “Proje tarifi”). Orada daha önce sakladığın bir proje varsa hangisinin kalacağı sana sorulur. Silmek için: editör video dosyasını yeniden istediğinde “Kayıtlı projeyi sil”e bas ya da tarayıcı ayarlarından bu sitenin verilerini temizle.',
  'cloud.privacy.stored.project.extra':
    'İnternette yazılan yazı için de aynı: editörde açarsan satırların metni ve kimin konuştuğu burada saklanır; ses, davet kodun ve şirketin yanıtı saklanmaz.',
  'cloud.privacy.others': 'Videoda başka insanlar konuşuyorsa onların sesi de gider. Göndermeden önce bunu düşün.',
  'cloud.privacy.ledger':
    'Aracı sunucumuzun tuttuğu kayıt: davet kodunun özeti, sesin süresi ve boyutu, işin durumu ve zamanı (90 gün); aşırı kullanımı önlemek için IP adresinin özeti (en çok yaklaşık bir saat). Ses, yazı ve dosya adı tutulmaz. Her internet sunucusu gibi Cloudflare de isteği taşırken IP adresini görür.',
  'cloud.privacy.quota':
    'Davet kodun kayıtlıysa, “Yazıyı nerede çıkaralım?” ekranı açıldığında kalan dakikanı sormak için kodun aracı sunucumuza gider. Bu istekte ses yoktur.',
  'cloud.privacy.trial':
    'Bu yol davetli bir denemedir ve ücretsizdir. Her davet kodunun belli bir dakika hakkı vardır; bir video en çok 120 dakika olabilir. Aylık bir harcama sınırımız var: dolunca bu yol o ay kapanır. “Cihazımda” yolu her zaman çalışır.',
  // Who answers for it (doc 30 K02). The name comes from the build (NEXT_PUBLIC_DATA_CONTROLLER_NAME); without it, said as undecided.
  'cloud.privacy.controller.unset':
    'Veri sorumlusu ve hukuki dayanak aşağıda “belirlenmedi” olarak durur; belirlenmeden deneme dışına açılmaz.',
  'cloud.privacy.controller.named':
    'Veri sorumlusu aşağıda yazılıdır: şirket kurulana kadar kurucunun kendisi, kişi olarak. Hukuki dayanak henüz belirlenmedi; belirlenmeden bu yol davetli deneme dışına açılmaz.',
  'cloud.privacy.stored.invite.name': 'Davet kodu (İnternette yazıya dökme)',
  'cloud.privacy.stored.invite.body':
    'Davet kodunu bir kez yazman yetsin diye bu tarayıcıda saklanır. Yalnızca sen “Kodu kaydet”e basınca ve kod kabul edilince yazılır.',
  'cloud.privacy.stored.invite.where': 'localStorage, “clip.cloudInvite” anahtarı',
  'cloud.privacy.stored.invite.delete': 'Aşağıdaki “Davet kodunu kaldır” düğmesiyle ya da “Yazıya dök” ekranındaki aynı düğmeyle.',
  'cloud.privacy.invite.present': 'Bu tarayıcıda kayıtlı bir davet kodu var.',
  'cloud.privacy.invite.absent': 'Bu tarayıcıda kayıtlı davet kodu yok.',
} as const;

export type CloudMessageKey = keyof typeof cloudTr;

/**
 * The provider's own pages the privacy page links to: the ones ADR-039 quotes (read 10 Oct 2026) for
 * retention, model training and the data processing addendum. Not fetched by the app; plain links.
 */
export const PROVIDER_PAGES = {
  retention: 'https://www.assemblyai.com/docs/data-retention-and-model-training',
  dpa: 'https://www.assemblyai.com/legal/data-processing-addendum',
} as const;

const dictionaries: Partial<Record<Locale, Record<CloudMessageKey, string>>> = { tr: cloudTr };

/** Makes English available (called by `cloudMessages.en.ts`, which only the English privacy page loads). */
export function registerCloudMessages(locale: Locale, dictionary: Record<CloudMessageKey, string>): void {
  dictionaries[locale] = dictionary;
}

export function cloudTranslator(locale: Locale = 'tr') {
  return (key: CloudMessageKey): string => (dictionaries[locale] ?? cloudTr)[key];
}
