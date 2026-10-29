package cn.shiguang;

import jakarta.persistence.*;
import java.time.Instant;

@Entity @Table(name="site_settings")
class SiteSetting {
 @Id @Column(name="setting_key",length=80) String key;
 @Column(name="setting_value",nullable=false,columnDefinition="text") String value;
 @Column(nullable=false) Instant updatedAt=Instant.now();
 String updatedBy;
 protected SiteSetting(){}
 SiteSetting(String key,String value,String updatedBy){this.key=key;this.value=value;this.updatedBy=updatedBy;}
}
