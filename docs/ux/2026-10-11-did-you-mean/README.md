# Arama: emin değilken “Bunu mu demek istedin?” — önce / sonra (11 Ekim 2026)

Karar kaydı: [ADR-034, “Güncelleme — 11 Ekim 2026”](../../adr/ADR-034-task-first-home.md).
Kurucu bu değişikliği sözle onayladı (“Bunu mu demek istedin?”, 2–3 seçenek); taslak çizilmedi, çünkü
yeni bir yerleşim yok: aynı sonuç satırları, aynı başlık, aynı “Tüm işleri gör”. Bu klasör, kurucu
bakıp **veto edebilsin** diye önceki ve sonraki ekranları yan yana tutar.

## Ne değişti

Arama her zaman bir sıra üretir. Değişen, ilk satırın **cevap** mı yoksa **seçeneklerden biri** mi
olduğudur:

| | Emin (değişmedi) | Emin değil (yeni) |
|---|---|---|
| Başlık | Bunu mu demek istedin? | Bunu mu demek istedin? |
| Başlığın altında | — | “Tam emin olamadım. Hangisini istiyorsan ona bas.” |
| İlk satır | seçili (çerçevesi renkli) | **hiçbiri seçili değil** |
| Satır sayısı | 1–3 | 1–3 (çalışan işler için eşik daha düşük: daha çok seçenek) |
| Enter | ilk satırı başlatır | **hiçbir şey başlatmaz**; “Önce birini seç” der. Ok tuşuyla seçilince başlatır |
| Dokunma / tıklama | satırı başlatır | satırı başlatır |
| Listenin altında | “Tüm işleri gör” | “Aradığın bunlardan biri değilse başka kelimelerle dene ya da bütün işlere bak.” + “Tüm işleri gör” |

Eklenen iki satır yazı dışında yeni bir öğe yoktur. “Bunu henüz yapamıyoruz.” ve “Bunu bulamadım.”
ekranları değişmedi.

## Ekranlar

Önce = `dd0301b` (yayındaki sürüm), sonra = bu dal. Masaüstü 1440 × 900, telefon 390 × 844.

| Yazılan | Ne gösteriyor | Önce | Sonra |
|---|---|---|---|
| `dikey yap` | emin cevap — **değişmemeli** | [masaüstü](once-masaustu-emin.png) · [telefon](once-telefon-emin.png) | [masaüstü](sonra-masaustu-emin.png) · [telefon](sonra-telefon-emin.png) |
| `sesi kes` | iki iş birer kelimeyle: iki seçenek | [masaüstü](once-masaustu-iki-secenek.png) · [telefon](once-telefon-iki-secenek.png) | [masaüstü](sonra-masaustu-iki-secenek.png) · [telefon](sonra-telefon-iki-secenek.png) |
| `bugün hava çok güzel` | sohbet; tek bir kelime (“güzel”) İyileştir’i çağırıyor: önce Enter’la başlayan tek kart, sonra tek seçenekli soru | [masaüstü](once-masaustu-tek-secenek.png) · [telefon](once-telefon-tek-secenek.png) | [masaüstü](sonra-masaustu-tek-secenek.png) · [telefon](sonra-telefon-tek-secenek.png) |
| `videoyu instagramda paylaş` | yapılamayan bir istek, bir kelimesi (“instagram”) Dikey yap’ı çağırıyor | [masaüstü](once-masaustu-liste-disi.png) · [telefon](once-telefon-liste-disi.png) | [masaüstü](sonra-masaustu-liste-disi.png) · [telefon](sonra-telefon-liste-disi.png) |

Görüntüler `web/scripts/shots-did-you-mean.mjs` ile, geliştirme sunucusundan alındı (sunucunun kendi
köşe rozeti gizlendi; başka hiçbir şeye dokunulmadı). “Önce” görüntüleri için `taskSearch.ts`
`dd0301b`’deki hâline döndürüldü; o sırada ekran bileşeni henüz değişmemişti.

## Bilinen zayıf yanlar (veto nedeni olabilir)

- **Tek seçenekli soru.** Aday tek ise liste tek satırdır (“bugün hava çok güzel” → yalnızca İyileştir).
  Soru sormak bir karta göndermekten iyidir, ama “2–3 seçenek” değildir. Ölçülen pay raporda yazılı
  (bölüm 2, “tek seçenek”).
- **Emin ekranın başlığı da “Bunu mu demek istedin?”** (3 Ekim’den beri öyle). İki durumu ayıran,
  seçili satır ve alttaki cümledir. Emin durumda başlığı “Bunu buldum” gibi bir şeye çevirmek ayrımı
  güçlendirirdi; “emin eşleşme bugünkü gibi kalsın” dendiği için dokunulmadı — kurucu kararı.
- **Fareyle üzerine gelmek** seçeneklerde satırı yalnızca aydınlatır, seçmez: Enter, fare listenin
  çıktığı yerde duruyor diye bir işi başlatmamalı. Emin durumda eskisi gibi seçer.
