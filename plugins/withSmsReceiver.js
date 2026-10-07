const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PACKAGE_NAME = 'com.abeltamrat.hisabtrackv1';
const SOURCE_DIR = path.join('app', 'src', 'main', 'java', ...PACKAGE_NAME.split('.'), 'sms');

const receiverSource = `package ${PACKAGE_NAME}.sms

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Telephony
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import ${PACKAGE_NAME}.MainActivity
import ${PACKAGE_NAME}.R
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.util.Locale

class HisabSmsReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

    val configuredSenders = SmsReceiverStore.getSenders(context)
    if (configuredSenders.isEmpty()) return

    val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
    if (messages.isEmpty()) return

    val grouped = messages.groupBy { message ->
      Pair(SmsReceiverStore.normalizeSender(message.originatingAddress.orEmpty()), message.timestampMillis)
    }

    var matched = false
    grouped.forEach { (key, parts) ->
      val sender = key.first
      if (sender.isEmpty() || sender !in configuredSenders) return@forEach

      val body = parts.joinToString(separator = "") { it.messageBody.orEmpty() }
      val digest = MessageDigest.getInstance("SHA-256")
        .digest("$sender|\${key.second}|$body".toByteArray())
        .joinToString(separator = "") { "%02x".format(it) }
        .take(24)

      // Store only a receipt signal and sender. The financial message body remains
      // in Android's SMS provider and is read by the existing parser when it runs.
      SmsReceiverStore.enqueue(context, JSONObject().apply {
        put("id", "received:$digest")
        put("address", parts.first().originatingAddress.orEmpty())
        put("date", key.second)
      })
      matched = true
    }

    if (matched) {
      HisabSmsModule.emitSmsReceived()
      showNotification(context)
    }
  }

  private fun showNotification(context: Context) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
      context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) return

    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(NotificationChannel(
        CHANNEL_ID,
        "Bank transactions",
        NotificationManager.IMPORTANCE_DEFAULT,
      ).apply {
        description = "New bank SMS transactions awaiting review"
      })
    }

    val openApp = Intent(context, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
      putExtra("hisab_sms_received", true)
    }
    val pendingIntent = PendingIntent.getActivity(
      context,
      7401,
      openApp,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle("New bank transaction")
      .setContentText("Open HisabTrack to review the transaction captured from SMS.")
      .setContentIntent(pendingIntent)
      .setAutoCancel(true)
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .build()
    NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
  }

  companion object {
    private const val CHANNEL_ID = "sms_transactions"
    private const val NOTIFICATION_ID = 7401
  }
}

internal object SmsReceiverStore {
  private const val PREFS = "hisab_sms_receiver"
  private const val SENDERS = "senders"
  private const val PENDING = "pending"
  private const val MAX_PENDING = 100

  fun normalizeSender(value: String): String = value
    .trim()
    .lowercase(Locale.ROOT)
    .replace(Regex("[\\\\s\\\\-()]"), "")

  fun getSenders(context: Context): Set<String> =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getStringSet(SENDERS, emptySet())
      .orEmpty()

  fun setSenders(context: Context, senders: Set<String>) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putStringSet(SENDERS, senders)
      .apply()
  }

  @Synchronized
  fun enqueue(context: Context, signal: JSONObject) {
    val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val queue = try {
      JSONArray(preferences.getString(PENDING, "[]"))
    } catch (_: Exception) {
      JSONArray()
    }
    val bounded = JSONArray()
    val start = maxOf(0, queue.length() - MAX_PENDING + 1)
    for (index in start until queue.length()) bounded.put(queue.get(index))
    bounded.put(signal)
    preferences.edit().putString(PENDING, bounded.toString()).commit()
  }

  @Synchronized
  fun consume(context: Context): String {
    val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val pending = preferences.getString(PENDING, "[]") ?: "[]"
    preferences.edit().remove(PENDING).commit()
    return pending
  }
}
`;

const moduleSource = `package ${PACKAGE_NAME}.sms

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

class HisabSmsModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  init {
    reactContext = context
  }

  override fun getName(): String = "HisabSmsReceiver"

  @ReactMethod
  fun configureSenders(values: com.facebook.react.bridge.ReadableArray, promise: Promise) {
    try {
      val senders = mutableSetOf<String>()
      for (index in 0 until values.size()) {
        val sender = SmsReceiverStore.normalizeSender(values.getString(index).orEmpty())
        if (sender.isNotEmpty()) senders.add(sender)
      }
      SmsReceiverStore.setSenders(reactApplicationContext, senders)
      if (senders.isEmpty()) SmsReceiverStore.consume(reactApplicationContext)
      promise.resolve(senders.size)
    } catch (error: Exception) {
      promise.reject("SMS_RECEIVER_CONFIG", error)
    }
  }

  @ReactMethod
  fun consumePendingSignals(promise: Promise) {
    try {
      promise.resolve(SmsReceiverStore.consume(reactApplicationContext))
    } catch (error: Exception) {
      promise.reject("SMS_RECEIVER_CONSUME", error)
    }
  }

  @ReactMethod fun addListener(eventName: String) = Unit
  @ReactMethod fun removeListeners(count: Int) = Unit

  companion object {
    private var reactContext: ReactApplicationContext? = null

    fun emitSmsReceived() {
      val context = reactContext ?: return
      if (!context.hasActiveReactInstance()) return
      context
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("HisabSmsReceived", Arguments.createMap())
    }
  }
}
`;

const packageSource = `package ${PACKAGE_NAME}.sms

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class HisabSmsPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
    listOf(HisabSmsModule(context))

  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
`;

function withSmsManifest(config) {
  return withAndroidManifest(config, (mod) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    application.receiver = application.receiver || [];
    const name = `.${'sms.HisabSmsReceiver'}`;
    if (!application.receiver.some((receiver) => receiver.$?.['android:name'] === name)) {
      application.receiver.push({
        $: {
          'android:name': name,
          'android:enabled': 'true',
          'android:exported': 'true',
          'android:permission': 'android.permission.BROADCAST_SMS',
        },
        'intent-filter': [{
          $: { 'android:priority': '999' },
          action: [{ $: { 'android:name': 'android.provider.Telephony.SMS_RECEIVED' } }],
        }],
      });
    }
    return mod;
  });
}

function withSmsSources(config) {
  return withDangerousMod(config, ['android', async (mod) => {
    const androidRoot = mod.modRequest.platformProjectRoot;
    const sourceDir = path.join(androidRoot, SOURCE_DIR);
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'HisabSmsReceiver.kt'), receiverSource);
    fs.writeFileSync(path.join(sourceDir, 'HisabSmsModule.kt'), moduleSource);
    fs.writeFileSync(path.join(sourceDir, 'HisabSmsPackage.kt'), packageSource);

    const applicationPath = path.join(androidRoot, 'app', 'src', 'main', 'java', ...PACKAGE_NAME.split('.'), 'MainApplication.kt');
    let application = fs.readFileSync(applicationPath, 'utf8');
    const packageImport = `import ${PACKAGE_NAME}.sms.HisabSmsPackage`;
    if (!application.includes(packageImport)) {
      application = application.replace('import android.content.res.Configuration', `import android.content.res.Configuration\n${packageImport}`);
    }
    if (!application.includes('add(HisabSmsPackage())')) {
      application = application.replace(
        '// add(MyReactNativePackage())',
        '// add(MyReactNativePackage())\n              add(HisabSmsPackage())',
      );
    }
    fs.writeFileSync(applicationPath, application);
    return mod;
  }]);
}

module.exports = function withSmsReceiver(config) {
  return withSmsSources(withSmsManifest(config));
};

