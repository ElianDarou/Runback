package com.runback.integrations

import android.app.Activity
import android.os.Bundle
import android.graphics.Color
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Button
import com.runback.core.Lang

class HealthRationaleActivity : Activity() {
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        val padding = (24 * resources.displayMetrics.density).toInt()
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(padding,padding*2,padding,padding)
            setBackgroundColor(Color.rgb(16,18,16))
        }
        layout.addView(TextView(this).apply {text=Lang.tr("Daten in Health Connect","Data in Health Connect");textSize=24f;setTextColor(Color.WHITE)})
        layout.addView(TextView(this).apply {
            text=Lang.tr("Runback liest nur freigegebene Trainings- und Kontextdaten für deine lokale Laufanalyse. Fertige Runback-Läufe werden nur auf deinen Wunsch geschrieben. Die Route ist separat wählbar.\n\nDie Runback-Datenbank bleibt auf diesem Gerät. Andere Apps können eigene Cloud-Funktionen verwenden. Freigaben lassen sich jederzeit in Health Connect widerrufen.\n\nOhne Health Connect funktioniert die Laufaufzeichnung weiter.",
                "Runback reads only the training and context data you share, for your local run analysis. Finished Runback runs are written only when you ask. The route can be chosen separately.\n\nThe Runback database stays on this device. Other apps may use their own cloud features. You can revoke sharing in Health Connect at any time.\n\nWithout Health Connect, run recording still works.")
            textSize=17f;setTextColor(Color.rgb(230,235,230));setPadding(0,padding,0,padding)
        })
        layout.addView(Button(this).apply {text=Lang.tr("Schließen","Close");setOnClickListener {finish()}})
        setContentView(layout)
    }
}
