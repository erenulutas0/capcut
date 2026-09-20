# 24 — Gözlemlenebilirlik, Destek Operasyonu ve Olay Müdahalesi

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## SLO önerileri

Amaç, desteklenen kullanıcı işini güvenilir tutmak. İlk sayısal SLO'lar gerçek beta baseline'ıyla onaylanır; bu belge 7/24 hizmet garantisi değildir. Render success, çıktı teslimi, queue gecikmesi, auth/billing doğrulama ve silme job başarısı ayrı izlenir.

En kritik alarmlar: başka hesaba erişim şüphesi, failed deletion backlog, çift usage debit, beklenmeyen cloud gider sıçraması, düşük başarılı export oranı, webhook inbox birikimi ve provider state ile entitlement farkı.

## Teknik ölçümler

API latency/error; queue depth ve oldest queued age; worker CPU/RAM/disk/timeout; job duration/engine/codec; reserved vs used seconds; orphan reservations; storage büyümesi/lifecycle deletion; provider verification delay; crash-free export attempts. Aşırı yüksek cardinality'li kullanıcı filename/path log label'ı yok.

Correlation: request ID→job ID→attempt ID→worker engine version. Medya içerik hash'i veya imzalı download URL loga gerekmez. Kullanıcıdan hata kodu paylaşması istenir; videosunu otomatik almak şart değildir.

## Olay şiddeti

SEV0: aktif veri sızıntısı/secret ele geçirme/yetkisiz medya erişimi. SEV1: yaygın veri kaybı, yanlış ücret/hak, core export geniş kesinti. SEV2: belirli codec/platform arızası, cloud gecikmesi. SEV3: küçük UX/hata mesajı sorunları. Bu etiketler iç önceliklendirmedir.

## Runbook A — Bulut maliyeti sıçradı

Önce trial/free workload ile paid workload ayrılır. Yeni denemeler/promo grant'leri geçici durdurulur; aktif job'lar kapasite sınırları içinde değerlendirilir. Worker maliyetini codec, input duration ve retry sayısına böl. Abuse veya bug varsa ilgili rota/hesap sınırlanır. Ücretli kullanıcı hakkını sessizce azaltma; hizmet verilemiyorsa açık hata, yerel alternatif ve uygun telafi süreci kullan.

## Runbook B — Job yarıda kaldı

Job state, heartbeat, lease epoch ve object varlığı kontrol edilir. Çalışan worker olabilecekken aynı işi körlemesine yeniden başlatma. Lease gerçekten sona ermişse fence eski worker, izinli retry yarat, reservation aynı kalır. Terminal fail ise release; geç callback double-debit yapamaz. Orphan temp/objects temizlenir.

## Runbook C — Billing tutarsızlığı

Kullanıcıdan yeniden satın alma istemeden provider server truth sorgulanır. Receipt owner, environment, paidThrough ve event sırası incelenir. Hak düzeltme ve grant reconciliation audit kaydıyla yapılır. Yanlış tahsilat varsa sağlayıcının uygun iade süreci uygulanır; elde tutmak için kullanıcıyı oyalama yok.

## Runbook D — Medya veya secret sızıntısı

Etkilenen erişim/prefix/anahtar kapatılır, kısa ömürlü URL'ler iptal mekanizmasıyla erişilemez hale getirilir, etki çevresi ve zaman aralığı belirlenir. Kanıtın güvenli korunması, gerekli kullanıcı/otorite bildirimleri uzmanla değerlendirilir. Log temizleyerek olayı gizleme; kişisel veri içeren kanıtın kendisini de gereksiz çoğaltma.

## Runbook E — Silme başarısızlığı

Kullanıcı erişimini hemen kapalı tut. DB, auth provider, object storage, analytics/CRM ve backup döngüsü ayrı kontrol edilir. Lifecycle gecikmesi saklanmaz; gerçek deletion retry alarmı ve doğrulama kaydı tutulur. Backup restore sonrası tombstone uygulanır.

## Yedek ve kurtarma

Medya arşivi yok; DB/metadata yedeği şifreli, erişimi kısıtlı ve saklama planına uygun. Önerilen ilk hedef metadata RPO 24 saat, RTO bir iş günü; bunlar sözleşme SLA'sı değil test edilecek iç hedeftir. Usage/ödeme kayıt kaybı riski nedeniyle provider reconciliation ayrıca gerekir.

Restore tatbikatında ayrı ortam, silinmiş hesapların geri dönmemesi, idempotency kayıtları, son grant'ler ve outbox yeniden oynatma kontrol edilir. Backup varlığı restore edilebilirlik kanıtı değildir.

## Kurucu ritmi

Günlük beta: export errors, kullanıcı tıkanması, harcama ve silme kuyruğu. Haftalık: en sık üç hata, destek süresi, test matrisi boşluğu ve retention. Aylık: unit economics, dependency/security güncelleme ve politika değişimi. Tek geliştirici olduğu için otomasyonla rutin azaltılır; gerçek kapasite dışında kesintisiz destek sözü verilmez.
