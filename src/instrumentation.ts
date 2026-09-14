// Next.js sunucu örneği başlarken bir kez çalışır. MQTT aboneliğini burada
// başlatıyoruz; `next start` uzun ömürlü tek bir process olduğu için istemci
// uygulamanın ömrü boyunca ayakta kalır.
//
// İki kritik nokta:
//  - register() sunucu istek almaya başlamadan ÖNCE tamamlanmak zorunda ve
//    içinden atılan hata yeniden fırlatılır → sunucu hiçbir isteği kabul etmez.
//    Bu yüzden try/catch var ve bağlantı AWAIT EDİLMİYOR (mqtt.connect zaten
//    istemciyi anında döndürüp arka planda bağlanır).
//  - register() tüm runtime'larda çağrılır, o yüzden nodejs kontrolü şart.
//    (next build sırasında çağrılmaz, build brokera bağlanmaya çalışmaz.)
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.MQTT_URL) return;

  try {
    const { getMqttClient } = await import("./lib/mqtt");
    getMqttClient();
  } catch (err) {
    console.error("MQTT başlatılamadı, uygulama MQTT'siz devam ediyor:", err);
  }
}
