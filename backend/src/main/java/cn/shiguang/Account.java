package cn.shiguang;
import jakarta.persistence.*;
@Entity @Table(name="accounts")
class Account {
 @Id short id;
 @Column(nullable=false,unique=true) String username;
 @Column(nullable=false) String password;
 @Column(nullable=false) String nickname;
 @Column(nullable=false) String role;
 protected Account(){}
}
