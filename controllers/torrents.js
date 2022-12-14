const Torrent = require("../models/Torrent");
const User = require("../models/User");
const archiver = require("archiver"); // the new archiving module
const { createTorrentArchive } = require("../middleware/archive.js");
const fs = require("fs-extra");
const { client } = require("../config/webtorrent");
const parseTorrent = require("parse-torrent");
const moment = require("moment");

module.exports = {
  getClientDashboard: async (req, res) => {
    try {
      const user = await User.findByPk(req.user.id);
      let upMax = client.getUploadLimit();
      let downMax = client.getDownloadLimit();
      let upRate = client.uploadSpeed;
      let downRate = client.downloadSpeed;
      let torrentsArray = client.torrents;
      res.render("dashboard", {
        user,
        torrentsArray,
        upRate,
        downRate,
        upMax,
        downMax,
      });
    } catch (err) {
      console.error(err);
      res.status(404).send(":(");
    }
  },

  getSeeding: async (req, res) => {
    try {
      const user = await User.findByPk(req.user.id);
      let upMax = client.getUploadLimit();
      let downMax = client.getDownloadLimit();
      let upRate = client.uploadSpeed;
      let downRate = client.downloadSpeed;
      let torrentsArray = client.torrents.filter((torrent) => torrent.done);
      res.render("dashboard", {
        user,
        torrentsArray,
        upRate,
        downRate,
        upMax,
        downMax,
      });
    } catch (err) {
      console.error(err);
      res.status(404).send(":(");
    }
  },

  getLeeching: async (req, res) => {
    try {
      const user = await User.findByPk(req.user.id);
      let upMax = client.getUploadLimit();
      let downMax = client.getDownloadLimit();
      let upRate = client.uploadSpeed;
      let downRate = client.downloadSpeed;
      let torrentsArray = client.torrents.filter((torrent) => !torrent.done);
      res.render("dashboard", {
        user,
        torrentsArray,
        upRate,
        downRate,
        upMax,
        downMax,
      });
    } catch (err) {
      console.error(err);
      res.status(404).send(":(");
    }
  },

  viewTorrent: async (req, res) => {
    try {
      const user = await User.findByPk(req.user.id);
      const torrentRecord = await Torrent.findByPk(req.params.id);
      const torrent = client.get(torrentRecord.id);
      const createdDate = moment(torrent.created).format(
        "MMMM Do YYYY, hh:mm:ss a"
      );

      res.render("viewTorrent", {
        user,
        torrent,
        createdDate,
      });
    } catch (err) {
      console.error(err);
      res.status("500").send(":(");
    }
  },

  postTorrent: async (req, res) => {
    try {
      const category = req.body.category;
      let torrentID = req.file ? req.file.path : req.body.magnet;
      if (typeof torrentID === "string") {
        torrentID = torrentID.split("'").join("");
        torrentID = torrentID.split(" ").join("").trim();
      }
      if (torrentID.startsWith("'") || torrentID.endsWith("'")) {
        req.flash("errors", {
          msg: "Invalid TorrentID",
        });
        res.redirect("dashboard");
      }
      let torrentExists;
      let id;
      if (torrentID.startsWith("magnet")) {
        id = parseTorrent(torrentID).infoHash;
      } else {
        id = parseTorrent(fs.readFileSync(req.file.path)).infoHash;
      }
      torrentExists = await Torrent.findByPk(id);

      if (!torrentExists) {
        client.add(
          torrentID,
          {
            path: `database/torrents/${category}/`,
          },
          async (torrent) => {
            torrentID = req.file ? torrent.torrentFile : torrentID;
            const newTorrent = Torrent.build({
              id: torrent.infoHash,
              name: torrent.name,
              torrentID: torrentID,
              folderPath: `database/torrents/${category}/${torrent.name}`,
              category: category,
            });
            await newTorrent.save();
            console.log(
              `\nTorrent file ${torrent.name} succesfully leeching, saving metadata to DB\n`
            );
          }
        );
        req.flash("info", { msg: "Torrent added to the nest" });
      } else {
        req.flash("errors", { msg: "Torrent already in the nest" });
      }
      if (req.file) {
        console.log("\nCleaning out .torrent files from uploads folder...\n");
        fs.remove(req.file.path, (err) => {
          if (err)
            return console.error(
              ".torrent upload was not removed after being added to client\n"
            );
          console.log("\n.torrent files removed\n");
        });
      }
      res.redirect("dashboard");
    } catch (err) {
      console.error(err);
      req.flash("errors", {
        msg: "Please upload a valid magnet uri or .torrent file",
      });
      return res.redirect("dashboard");
    }
  },

  downloadTorrent: async (req, res) => {
    try {
      const torrentRecord = await Torrent.findByPk(req.params.id);
      let torrentPath = torrentRecord.folderPath;
      if (!fs.existsSync(torrentPath)) {
        console.log(
          "\nCan't find requested torrent\nRegenerating file path for torrent record..."
        );
        torrentPath = `database/torrents/${torrentRecord.category}/${torrentRecord.name}`;
      }

      const status = client.get(torrentRecord.id);
      const torrentIsDir = fs.statSync(torrentPath).isDirectory();

      if (status.done) {
        if (torrentIsDir) {
          // archive creation process

          const writeStream = fs.createWriteStream(
            `${torrentPath}/${torrentRecord.name}.zip`
          );
          const archive = archiver("zip", { zlib: { level: 9 } });

          // Fires when the archive is finalized whether there is a descriptor or not
          writeStream.on("close" || "end", async () => {
            console.info("\nFinished archiving torrent");
            console.info(archive.pointer() + " total bytes");
            //updating the path will ensure the next download will be faster
            console.info(`\nUpdating ${torrentRecord.name} path in database`);
            torrentPath = `${torrentPath}/${torrentRecord.name}.zip`;
            await Torrent.update(
              { folderPath: torrentPath },
              {
                where: {
                  id: req.params.id,
                },
              }
            );
            console.info("\nSuccess! Sending torrent archive to user!");
            res.download(torrentPath);
          });

          console.info("\nCreating torrent archive...");
          await createTorrentArchive(
            torrentPath,
            torrentRecord.name,
            writeStream,
            archive
          );
        } else {
          console.info("\nSending torrent file to user!");
          res.download(torrentPath);
        }
      } else {
        req.flash("info", {
          msg: "Torrent file is not finished seeding.",
        });
        return res.redirect("../dashboard");
      }
    } catch (err) {
      console.error(err);
      req.flash("errors", {
        msg: "Error couldn't download torrent file from database",
      });
      return res.redirect("../dashboard");
    }
  },

  deleteTorrent: async (req, res) => {
    try {
      const torrentRecord = await Torrent.findByPk(req.params.id);
      console.log(
        `\nRemoving torrent record ${torrentRecord.id} from database...`
      );
      await torrentRecord.destroy();
      client.remove(req.params.id);
      req.flash("info", {
        msg: `Torrent record ${req.params.id} has been deleted`,
      });
      res.redirect("dashboard");
    } catch (err) {
      console.error(err);
      res.redirect("dashboard");
    }
  },
};
