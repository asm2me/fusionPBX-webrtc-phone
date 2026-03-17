<?php

/*
	FusionPBX
	Version: MPL 1.1

	Click-to-Dial - Database Schema
	Creates the v_click_to_dial_tokens table.
	Run this once or include it from app_defaults.php.
*/

//includes
$document_root = dirname(__DIR__, 2);
require_once $document_root."/resources/require.php";

//create the table if it doesn't exist
$sql = "CREATE TABLE IF NOT EXISTS v_click_to_dial_tokens ( ";
$sql .= "click_to_dial_token_uuid uuid PRIMARY KEY, ";
$sql .= "domain_uuid uuid NOT NULL, ";
$sql .= "extension_uuid uuid NOT NULL, ";
$sql .= "api_token varchar(128) NOT NULL UNIQUE, ";
$sql .= "token_name varchar(255), ";
$sql .= "allowed_origins text, ";
$sql .= "button_color varchar(20) DEFAULT '#1a73e8', ";
$sql .= "button_position varchar(20) DEFAULT 'bottom-right', ";
$sql .= "button_label varchar(100) DEFAULT '', ";
$sql .= "token_enabled varchar(10) DEFAULT 'true', ";
$sql .= "insert_date timestamptz DEFAULT now(), ";
$sql .= "insert_user uuid, ";
$sql .= "update_date timestamptz, ";
$sql .= "update_user uuid ";
$sql .= ") ";

$database = new database;
$database->execute($sql);
unset($sql);

echo "v_click_to_dial_tokens table created or already exists.\n";

?>
