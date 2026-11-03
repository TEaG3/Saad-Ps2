package com.saadps2.artwork
import android.os.Bundle
import com.getcapacitor.BridgeActivity
class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(SafStoragePlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
