-- Create salesman table
CREATE TABLE IF NOT EXISTS salesman (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE
);

-- Create building_types table
CREATE TABLE IF NOT EXISTS building_types (
  id INT AUTO_INCREMENT PRIMARY KEY,
  type VARCHAR(255) NOT NULL UNIQUE
);

-- Create postal_codes table for geographic lookups
CREATE TABLE IF NOT EXISTS postal_codes (
  postal_code VARCHAR(10) NOT NULL,
  village VARCHAR(100) NOT NULL,
  district VARCHAR(100) NOT NULL,
  city VARCHAR(100) NOT NULL,
  province VARCHAR(100) NOT NULL,
  search_timestamp DATETIME NOT NULL,
  PRIMARY KEY (postal_code, village),
  KEY idx_postal_code (postal_code),
  KEY idx_village (village),
  KEY idx_district (district),
  KEY idx_city (city)
);

-- Create submissions table
CREATE TABLE IF NOT EXISTS submissions (
  id VARCHAR(36) PRIMARY KEY,
  timestamp DATETIME NOT NULL,
  salesmanName VARCHAR(255) NOT NULL,
  customerName VARCHAR(255) NOT NULL,
  customerAddress TEXT NOT NULL,
  customerHomeNo VARCHAR(255) NOT NULL,
  village TEXT NOT NULL,
  coordinates VARCHAR(255) NOT NULL,
  buildingType VARCHAR(255) NOT NULL,
  operators JSON NOT NULL,
  writeToAllOperatorSpreadsheetAt timestamp DEFAULT NULL,
  writeToFSOperatorSpreadsheetAt timestamp DEFAULT NULL,
  checkCoverageBotId int DEFAULT NULL,
  checkCoverageBotFinish int DEFAULT 0
);

-- Create building_photos table
CREATE TABLE IF NOT EXISTS building_photos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  submission_id VARCHAR(36) NOT NULL,
  filename VARCHAR(255) NOT NULL,
  FOREIGN KEY (submission_id) REFERENCES submissions(id)
);

truncate salesman;
INSERT INTO salesman values (default, "M. Syafi'i  - 0200519");
INSERT INTO salesman values (default, "Budiman Silalahi - 0201005");
INSERT INTO salesman values (default, "Rizki Hidayat - 0201315");
INSERT INTO salesman values (default, "Jimmy Heryanto - 0201318");
INSERT INTO salesman values (default, "Fani Hardianto - 0201516");
INSERT INTO salesman values (default, "Santoso Budi Utomo  - 0201610");
INSERT INTO salesman values (default, "Mauliddana Syahputra - 0201615");
INSERT INTO salesman values (default, "Andri Susilo - 0201702");
INSERT INTO salesman values (default, "Nicolas Dastahi Irnes Simbolon - 0201703");
INSERT INTO salesman values (default, "Jayagharaj  - 0201715");
INSERT INTO salesman values (default, "Customer Relation Officer  - CS");
INSERT INTO salesman values (default, "Januar Ilham - 0201828");
INSERT INTO salesman values (default, "Jopy Girsang - 0201904");
INSERT INTO salesman values (default, "Ramon Wiryawan - 0201908");
INSERT INTO salesman values (default, "Firtana Alfarsy - 0201925");
INSERT INTO salesman values (default, "Customer Service Bali  - CSBALI");
INSERT INTO salesman values (default, "Customer Service Nusa.Id  - CSNUSAID");
INSERT INTO salesman values (default, "Desy Anggreny Sitorus - 0202016");
INSERT INTO salesman values (default, "Miranda Meiyuliana Gultom - 0202211");
INSERT INTO salesman values (default, "Roni  - 0202213");
INSERT INTO salesman values (default, "Fauzan  - 0202214");
INSERT INTO salesman values (default, "Hanif Roofiif Tri Pambudi - 0202224");
INSERT INTO salesman values (default, "I Putu Agus Ari Wiweka, ST - 0202229");
INSERT INTO salesman values (default, "Josua Purba - 0202274");
INSERT INTO salesman values (default, "Diva Wiera Buana - 0202302");
INSERT INTO salesman values (default, "Indri Br Girsang - 0202314");
INSERT INTO salesman values (default, "Cellyna Setyowati - 0202353");
INSERT INTO salesman values (default, "Jhon Chairuddin - 0202328");
INSERT INTO salesman values (default, "Customer Service Nusawork  - CSPM");
INSERT INTO salesman values (default, "Dita Wulan Sari - 0202358");
INSERT INTO salesman values (default, "I Ketut Gede Udha Krisna Yasa - 0202372");
INSERT INTO salesman values (default, "Jaka Adeputra Panggabean - 0202379");
INSERT INTO salesman values (default, "I Gst Ag Ayu Ardha Nareswari - 0202402");
INSERT INTO salesman values (default, "Galang Furqon Oktafian - 0202421");
INSERT INTO salesman values (default, "Nadya Jasmien Nabillah - 0202428");
INSERT INTO salesman values (default, "Ni Luh Buda Sukayani - 0202450");
INSERT INTO salesman values (default, "Rina Sukmawati - 0202471");
INSERT INTO salesman values (default, "Rizka Ananda Aulia - 0202480");
INSERT INTO salesman values (default, "Gebby Eliza - 0202483");
INSERT INTO salesman values (default, "Aslinda  - 0202484");
INSERT INTO salesman values (default, "Tengku Mohammad Rafliansyah Bach - 0202494");
INSERT INTO salesman values (default, "Syarifah Balgis Mas - 0202495");
INSERT INTO salesman values (default, "freddy  - 0202499");
INSERT INTO salesman values (default, "Mohammad Azwar Syahputra - 0202501");
INSERT INTO salesman values (default, "Asnida  - 0202510");
INSERT INTO salesman values (default, "Rifqi Anugrah Putra - 0202511");
INSERT INTO salesman values (default, "Alfian Tri Utomo - 0202512");

truncate building_types;
INSERT INTO building_types values (default, "perumahan");
INSERT INTO building_types values (default, "ruko");