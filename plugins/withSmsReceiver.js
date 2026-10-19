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
      val deliveredToReact = HisabSmsModule.emitSmsReceived()
      HisabSmsNotifications.showCaptured(context)
      if (!deliveredToReact) HisabSmsHeadlessService.start(context)
    }
  }
}

internal object HisabSmsNotifications {
  private const val CHANNEL_ID = "sms_transactions"
  private const val NOTIFICATION_ID = 7401

  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.createNotificationChannel(NotificationChannel(
      CHANNEL_ID,
      "Bank transactions",
      NotificationManager.IMPORTANCE_HIGH,
    ).apply {
      description = "New bank SMS transactions awaiting review"
    })
  }

  fun showCaptured(context: Context) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
      context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) return

    ensureChannel(context)

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
      .setContentTitle("New bank SMS detected")
      .setContentText("Open HisabTrack to review the new transaction draft.")
      .setContentIntent(pendingIntent)
      .setAutoCancel(true)
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .build()
    NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
  }
}

internal object SmsReceiverStore {
  private const val PREFS = "hisab_sms_receiver"
  private const val SENDERS = "senders"
  private const val PENDING = "pending"
  private const val SCOPE = "scope"
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

  fun getScope(context: Context): String =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getString(SCOPE, "")
      .orEmpty()

  fun setScope(context: Context, scope: String) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(SCOPE, scope.trim())
      .commit()
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

const bootReceiverSource = `package ${PACKAGE_NAME}.sms

import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager

class HisabBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED &&
      intent.action != Intent.ACTION_MY_PACKAGE_REPLACED
    ) return

    context.packageManager.setComponentEnabledSetting(
      ComponentName(context, HisabSmsReceiver::class.java),
      PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
      PackageManager.DONT_KILL_APP,
    )
    HisabSmsNotifications.ensureChannel(context)
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
  fun configureScope(scope: String, promise: Promise) {
    try {
      SmsReceiverStore.setScope(reactApplicationContext, scope)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("SMS_RECEIVER_SCOPE", error)
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

    fun emitSmsReceived(): Boolean {
      val context = reactContext ?: return false
      if (!context.hasActiveReactInstance()) return false
      context
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("HisabSmsReceived", Arguments.createMap())
      return true
    }
  }
}
`;

const headlessServiceSource = `package ${PACKAGE_NAME}.sms

import android.content.Context
import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class HisabSmsHeadlessService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val scope = intent?.getStringExtra(EXTRA_SCOPE).orEmpty()
    if (scope.isBlank()) return null
    val payload = Arguments.createMap().apply {
      putString("scope", scope)
      putDouble("receivedAt", intent?.getLongExtra(EXTRA_RECEIVED_AT, 0L)?.toDouble() ?: 0.0)
    }
    return HeadlessJsTaskConfig(TASK_NAME, payload, 90_000L, true)
  }

  companion object {
    private const val TASK_NAME = "HisabSmsHeadlessTask"
    private const val EXTRA_SCOPE = "scope"
    private const val EXTRA_RECEIVED_AT = "receivedAt"

    fun start(context: Context) {
      val scope = SmsReceiverStore.getScope(context)
      if (scope.isBlank()) return
      val intent = Intent(context, HisabSmsHeadlessService::class.java).apply {
        putExtra(EXTRA_SCOPE, scope)
        putExtra(EXTRA_RECEIVED_AT, System.currentTimeMillis())
      }
      try {
        HeadlessJsTaskService.acquireWakeLockNow(context)
        context.startService(intent)
      } catch (_: Exception) {
        // The receipt signal remains queued for the foreground fallback.
      }
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
    const bootName = `.${'sms.HisabBootReceiver'}`;
    if (!application.receiver.some((receiver) => receiver.$?.['android:name'] === bootName)) {
      application.receiver.push({
        $: {
          'android:name': bootName,
          'android:enabled': 'true',
          'android:exported': 'true',
        },
        'intent-filter': [{
          action: [
            { $: { 'android:name': 'android.intent.action.BOOT_COMPLETED' } },
            { $: { 'android:name': 'android.intent.action.MY_PACKAGE_REPLACED' } },
          ],
        }],
      });
    }
    application.service = application.service || [];
    const serviceName = `.${'sms.HisabSmsHeadlessService'}`;
    if (!application.service.some((service) => service.$?.['android:name'] === serviceName)) {
      application.service.push({
        $: {
          'android:name': serviceName,
          'android:enabled': 'true',
          'android:exported': 'false',
        },
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
    fs.writeFileSync(path.join(sourceDir, 'HisabBootReceiver.kt'), bootReceiverSource);
    fs.writeFileSync(path.join(sourceDir, 'HisabSmsModule.kt'), moduleSource);
    fs.writeFileSync(path.join(sourceDir, 'HisabSmsPackage.kt'), packageSource);
    fs.writeFileSync(path.join(sourceDir, 'HisabSmsHeadlessService.kt'), headlessServiceSource);

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

