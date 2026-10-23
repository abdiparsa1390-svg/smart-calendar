CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) NOT NULL PRIMARY KEY,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  email_verified_at DATETIME NULL,
  verification_token_hash CHAR(64) NULL,
  verification_expires_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX users_verification_token_idx (verification_token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_settings (
  user_id CHAR(36) NOT NULL PRIMARY KEY,
  base_url VARCHAR(1000) NOT NULL,
  model VARCHAR(200) NOT NULL,
  api_key_ciphertext MEDIUMTEXT NOT NULL,
  api_key_iv VARCHAR(64) NOT NULL,
  api_key_tag VARCHAR(64) NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT ai_settings_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_events (
  user_id CHAR(36) NOT NULL,
  id VARCHAR(100) NOT NULL,
  title VARCHAR(240) NOT NULL,
  start_at DATETIME NOT NULL,
  end_at DATETIME NOT NULL,
  color CHAR(7) NOT NULL DEFAULT '#6d72d9',
  place VARCHAR(2000) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, id),
  INDEX user_events_user_start_idx (user_id, start_at),
  CONSTRAINT user_events_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS request_limits (
  scope VARCHAR(32) NOT NULL,
  ip_hash CHAR(64) NOT NULL,
  window_start DATETIME NOT NULL,
  hits INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, ip_hash),
  INDEX request_limits_window_idx (window_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
