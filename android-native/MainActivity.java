package com.saadps2.artwork;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SafStoragePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
