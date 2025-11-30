-- QR Automation Server Control
-- Allows admin to specify which server(s) should automate QR generation
-- This gives flexibility to run QR automation on local, cloud, or both

CREATE TABLE IF NOT EXISTS qr_server_config (
    config_id INTEGER NOT NULL DEFAULT 1 CHECK (config_id = 1),
    -- Which server should run QR automation
    -- Options: 'local', 'cloud', 'both', 'none'
    active_server TEXT NOT NULL DEFAULT 'local' 
        CHECK (active_server IN ('local', 'cloud', 'both', 'none')),
    
    -- Server identification
    local_server_name TEXT DEFAULT 'local-dev',
    cloud_server_name TEXT DEFAULT 'render-cloud',
    
    -- Enable/disable automation globally
    automation_enabled BOOLEAN NOT NULL DEFAULT true,
    
    -- Schedule settings
    schedule_start_time TIME DEFAULT '07:00:00',
    schedule_end_time TIME DEFAULT '18:00:00',
    active_days TEXT DEFAULT '1,2,3,4,5', -- 1=Monday to 5=Friday
    
    -- QR generation interval (in seconds)
    interval_seconds INTEGER DEFAULT 60 CHECK (interval_seconds >= 10 AND interval_seconds <= 3600),
    
    -- Admin notes/reason for configuration
    admin_notes TEXT,
    
    -- Audit trail
    updated_by INTEGER REFERENCES public.users(user_id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT qr_server_config_pkey PRIMARY KEY (config_id)
);

-- Audit log for configuration changes
CREATE TABLE IF NOT EXISTS qr_server_config_audit (
    audit_id BIGINT NOT NULL DEFAULT nextval('qr_server_config_audit_audit_id_seq'::regclass),
    config_id INTEGER NOT NULL,
    changed_by INTEGER REFERENCES public.users(user_id),
    previous_active_server TEXT,
    new_active_server TEXT,
    previous_settings JSONB,
    new_settings JSONB,
    change_reason TEXT,
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT qr_server_config_audit_pkey PRIMARY KEY (audit_id),
    CONSTRAINT qr_server_config_audit_config_fkey FOREIGN KEY (config_id) 
        REFERENCES qr_server_config(config_id)
);

-- Insert default configuration
INSERT INTO qr_server_config (config_id, active_server, automation_enabled)
VALUES (1, 'local', true)
ON CONFLICT (config_id) DO NOTHING;

-- Add sync columns for bidirectional sync
ALTER TABLE qr_server_config ADD COLUMN IF NOT EXISTS sync_updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila');
ALTER TABLE qr_server_config ADD COLUMN IF NOT EXISTS is_synced BOOLEAN DEFAULT false;
ALTER TABLE qr_server_config_audit ADD COLUMN IF NOT EXISTS sync_updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila');
ALTER TABLE qr_server_config_audit ADD COLUMN IF NOT EXISTS is_synced BOOLEAN DEFAULT false;
